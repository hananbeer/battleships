// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// You can also run a script with `npx hardhat run <script>`. If you do that, Hardhat
// will compile your contracts, add the Hardhat Runtime Environment's members to the
// global scope, and execute the script.
const hre = require("hardhat")

// A1-P16 or Ax1-PxF or simply 0x00-0xFF
// ABCDEFGHIJKLMNOP

const ships1 = [
  0x11, 0x21,                   // B2-C2 destroyer
  0x23,                         // C4    submarine
  0x44, 0x45,                   // E4-E5
  0x63, 0x64, 0x65,             // G3-G5
  0x71,                         // I2
  0x48, 0x58, 0x68, 0x78,       // E8-H8
  0x1A, 0x2A, 0x3A, 0x4A, 0x5A, // B10-F10
  0xFE, 0xFF
]

const ships2 = [
  0x11, 0x12,                   // B2-C2 destroyer
  0x32,                         // C4    submarine
  0x44, 0x54,                   // E4-E5
  0x36, 0x46, 0x56,             // G3-G5
  0x17,                         // I2
  0x84, 0x85, 0x86, 0x87,       // E8-H8
  0xA1, 0xA2, 0xA3, 0xA4, 0xA5, // B10-F10
  0xFE, 0xFF
]

const k256 = hre.ethers.utils.keccak256
const sleep = ms => new Promise(r => setTimeout(r, ms))

// hash two adjacent elements and returns a list, half the size, of the concatted hashes
function hash_reduce(list) {
  hashes = []
  for (let i = 0; i < list.length; i += 2) {
    // make 64-bytes preimage (list already hex-encoded, so only remove second '0x' and do normal string concat)
    let bytes = list[i] + list[i+1].substr(2)
    hashes.push(k256(bytes))
  }
  
  return hashes
}

function make_merkle_tree(board) {
  // basically 8 because 2^8 = 256 which is the board size in use
  // but let prepare for arbitrary size
  const ceil = Math.ceil(Math.log2(board.length))
  hashes = []
  // tree is built in reverse. populate tree with raw values leaves and their hashes
  tree = [board, hashes]
  for (let i = 0; i < board.length; i++) {
    // js int to bytes32 keccak; equivalient to solidity keccak256(bytes32(uint256_val))
    let preimage = '0x' + (board[i]).toString(16).padStart(64, '0')
    hashes.push(k256(preimage))
  }

  while (hashes.length > 1) {
    hashes = hash_reduce(hashes)
    tree.push(hashes)
  }

  // finally reverse the reversed tree to get the final tree :)
  return tree.reverse()
}

function make_proof(merkle_tree, index) {
  // at each node i, bring hash i and adjacent hash at i^1
  // root
  //   0     1
  // 00 01 10 11
  // ...........

  // the leaves at the last level contain raw values, not hashes
  // and their direct parents are their hashes, hence the -1
  let height = merkle_tree.length - 1
  let value = merkle_tree[height][index]
  let proof = []
  
  // skip the value's hash since it will be calculated from the value
  height--
  //index >>= 1

  while (height > 0) {
    rank = merkle_tree[height]
    path = index & 1
    adjacent_node = rank[index ^ 1]
    proof.push([path, adjacent_node])
    height--
    index >>= 1
  }

  return [proof, value]
}

function verify_merkle(root, value, proof) {
  // TODO: check proof height properly
  // this is just to avoid empty proofs
  if (proof.length == 0)
    return false

  let hash = k256(value)
  for (let i = 0; i < proof.length; i++) {
    let [path, adjacent_node] = proof[i]
    let data
    if (path == 0)
      data = hash + adjacent_node.substr(2)
    else
      data = adjacent_node + hash.substr(2)

    hash = k256(data)
  }

  return (hash == root)
}

function make_board(ships, salt=0) {
  board = []
  salt <<= 8
  for (let i = 0; i < 0x100; i++) {
    // giving ships ids won't work without revamping contract's acks..? :|
    // (if we expose ship id during game and ship id corresponds to ship length this is a weakness)
    //board.push(salt | (ships.indexOf(i)+1))

    if (ships.indexOf(i) != -1)
      board.push(salt | 1)
    else
      board.push(salt | 0)
  }

  return board
}

function draw_board(ships, missiles=[]) {
  output = 'x 0 1 2 3 4 5 6 7 8 9 a b c d e f'
  for (let i = 0; i < 0x100; i++) {
    if (i % 0x10 == 0)
      output += '\n' + (i/0x10).toString(16).toUpperCase() + '|'
    
    // uncomment to replace ships to board:
    // if (board[i] ^ 1 == salt) // ship (no xor for no ship but avoids mistakes if salt is wrong)
    let has_ship = (ships.indexOf(i) != -1)
    let has_missile = (missiles.indexOf(i) != -1)
    if (has_ship && has_missile)
      output += '*'
    else if (has_ship)
      output += 'o'
    else if (has_missile)
      output += '/'
    else
      output += ' '

    output += '|'
  }
  console.log(output + '\n')
  return output
}

function test_merkle(num_samples=5) {
  draw_board(ships1)

  // generate random salt
  // leave 9 extra bits at the end
  // one bit because signed int so to prevent overflow
  // another 8 bits for representing items in cells
  // (but then merkle proof needs to mask certain bits?)
  const salt = Math.floor(Math.random() * 0x7ffffff/*0x3fffffff*/)
  console.log('salt:', salt)

  // convert ship coordinates to a bitmap representing ship/no-ship
  // salt provides security from generating rainbow tables and
  // not only for the entire board, but locally too as a single
  // merkle proof could leak information about adjacent tiles
  // without a salt
  let board = make_board(ships1, salt)

  // the merkle tree has 9 levels, 8 levels for binary tree storing
  // hashes and one extra level for the pre-image values
  // (log2(n)+1 where n is board size = 16x16 = 256)
  let merkle_tree = make_merkle_tree(board)
  let root = merkle_tree[0][0]

  for (let i = 0; i < num_samples; i++) {
    // choose a random value to verify - note that values are salted!
    // the least-significant bit represents ship (1) / no-ship (0)
    // but merkle verification don't care about the underlying meaning
    // only that the values are indeed inside the merkle tree.
    let index = Math.floor(Math.random() * 0xff)
    let [proof, value] = make_proof(merkle_tree, index)
    let verified = verify_merkle(root, value, proof)
    if (!verified) {
      console.error(`failed to verify?? index: ${index}, value: ${value}, salt: ${salt}, root: ${root}`)
      return false
    }
  }

  console.log(`${num_samples} merkle paths verified!`)
  return true
}

class Player {
  constructor(game_contract, signer, id) {
    this.id = id
    this.game = game_contract.connect(signer)
    this.address = signer.address
  }

  // TODO: remove need for first_shot
  setup(ships, salt, first_shot) {
    //console.log(`preparing player ${this.id} @ ${this.address}`)
    this.salt = salt
    this.ships = ships
    this.board = make_board(ships, salt)
    this.merkle = make_merkle_tree(this.board)
    this.merkle_root = this.merkle[0][0]
    this.missiles = [first_shot]
    //console.log(`player ${this.id} merkle root: ${this.merkle_root}`)
  }

  async start() {
    return this.game.start(this.missiles[0])
  }

  async open() {
    return this.game.open(this.merkle_root)
  }

  async join(game_id) {
    return this.game.join(game_id, this.merkle_root)
  }

  async play(player_coord, opponent_coord) {
    return this.game.play(player_coord, opponent_coord)
  }
}

const Scenario = {
  normal: 0,
  fraud: 1,
  fault: 2,
  bail: 4,
  slash: 8,
}

const ScenarioStrings = {
  0: 'normal',
  1: 'fraud',
  2: 'fault',
  4: 'bail',
  8: 'slash',
}

class GameSimulator {
  async deploy() {
    this.game_id = -1

    const Factory = await hre.ethers.getContractFactory("Battleships")
    this.contract = await Factory.deploy()
  
    return this.contract.deployed()
  }

  setup(signer1, signer2) {
    this.player1 = new Player(this.contract, signer1, 1)
    this.player2 = new Player(this.contract, signer2, 2)
  }

  async simulate(scenario, verbose=false) {
    const do_fraud = ((scenario & Scenario.fraud) != 0)
    const do_fault = ((scenario & Scenario.fault) != 0)
    const do_slash = ((scenario & Scenario.slash) != 0)
    const do_bail = ((scenario & Scenario.bail) != 0)

    const verbose_print = (verbose ? console.log : (x) => {})

    // setup
    let missiles1 = [0x55]
    let missiles2 = [0x00] // first missile shot at 0x00 (important for testing)

    let m1 = missiles1[0]
    let m2 = missiles2[0]

    const salt1 = 0x100
    const salt2 = 0x200

    this.player1.setup(ships1, salt1, m1)
    this.player2.setup(ships2, salt2, m2)

    // open
    verbose_print('open: player 1 created new game room')
    await this.player1.open()
    this.game_id++ // starts at -1
  
    // join
    verbose_print('join: player 2 joined the game room')
    await this.player2.join(this.game_id)
  
    // TODO: test shuffle before & after start
  
    // start
    verbose_print('start: player 1 ready')
    await this.player1.start()
    verbose_print('start: player 2 ready')
    await this.player2.start() // TODO: player2 does not report missiles; should play() instead of start()...
  
    // play
    let promises = []
    for (let i = 0; i < 39; i++) {
      // player 1 is sophisticated.
      // he may or may not cheat.
      // he got intel on ships.
      // he obfuscates this fact by hitting only 50% of the time.
      m1 = (i % 2 == 0 ? ships2[i>>1] : (ships2[i>>1] + 11) & 0xff) // player 1 hits 50% of the time.
      missiles1.push(m1)

      if (verbose) {
        console.log(`move ${i}: player 1`)
        draw_board(ships1, missiles2)
      }

      let is_p2_hit = (ships1.indexOf(m2) != -1)
      promises.push(
        this.player1.game.play(m1, do_fraud ? false : is_p2_hit) // player 1 may or may not cheat.
      )
  
      // player 2 is naive.
      // he shoots in order.
      // he always reports honestly.
      // he also always loses.
      m2 = i + 1 // player 2 shoots in order.
      missiles2.push(m2)

      if (verbose) {
        console.log(`move ${i}: player 2`)
        draw_board(ships2, missiles1)
      }

      let is_p1_hit = (ships2.indexOf(m1) != -1)
      promises.push(
        this.player2.game.play(m2, is_p1_hit) // player 2 always honest.
      )

    }
  
    await Promise.all(promises)
  
    // end
    // _end() was called by last play() of player2 which is playing honest
  
    // -- finale --
    // slash
    if (do_slash) {
      try {
        console.log('slash: player 1 trying to slash illegaly during their own turn')
        console.warn("(expect: 'cannot slash during your turn')")
        await this.player1.game.slash()
      } catch (e) {
        console.warn(e.message)
      }
  
      // player2 played last by reporting loss and ending game
      // hence player2 may slash player1 (if slashing conditions met)
      if (do_bail) {
        console.log('bail: time traveling...')
        for (let i = 0; i < 101; i++)
          await hre.network.provider.send('evm_mine', [])
    
        try {
          console.log('slash: player 2 trying slash legally')
          console.log('(expect: slashed by ..)')
          await this.player2.game.slash()
        } catch (e) {
          console.warn(e.message)
        }
      } else {
        try {
          console.log('slash: player 2 trying slash prematurely')
          console.warn("(expect: 'not yet slashable')")
          await this.player2.game.slash()
        } catch (e) {
          console.warn(e.message)
        }
      }
    }
  
    // attest
    try {
      console.log('attest: player 1 committed to tell the truth, the whole truth and nothing but the truth')
      if (do_bail && do_slash)
        console.warn("(expect: 'invalid state for attest')")

      await this.player1.game.attest(this.player1.ships, this.player1.salt ^ (do_fraud ? 1 : 0))
    } catch (e) {
      console.warn(e.message)
    }

    // fault
    if (do_fault) {
      console.log('fault: player 2 proving player 1 fraud moves')
      if (do_fraud) {
        if (do_bail && do_slash)
          console.warn("(expect: 'invalid state for fault')")
        else
          console.log('(expect: fault proved by: ..)')
      } else {
        console.warn("(expect: 'no fault')")
      }

      try {
        await this.player2.game.fault(this.game_id) // TODO: should really store salt during attest...
      } catch (e) {
        console.warn(e.message)
      }
    }

    // claim
    try {
      console.log('claim: time traveling...')
      for (let i = 0; i < 101; i++)
        await hre.network.provider.send('evm_mine', [])
  
      console.log('claim: player 1 claiming reward')
      if ((do_bail && do_slash) || (do_fraud && do_fault))
        console.warn("(expect: 'invalid state for claim')")
      else
        console.log('(expect: claimed by: ..)')

      await this.player1.game.claim(this.game_id)
    } catch (e) {
      console.warn(e.message)
    }
  }
}

function get_config_string(scenario) {
  if (scenario == 0)
    return ScenarioStrings[0]

  let scenarios = []
  for (let i = 0; i < 4; i++) {
    if ((scenario & (1<<i)) != 0)
      scenarios.push(ScenarioStrings[1<<i])
  }

  return scenarios.join(', ')
}

async function main() {
  // test_merkle(500)
  // return

  // setup
  let signers = await hre.ethers.getSigners()
  if (signers.length < 2) {
    console.warn('required at least 2 accounts (signers) to play')
    return
  }

  let game = new GameSimulator()

  console.log('deploying game...')
  await game.deploy()
  console.log('deployed:', game.contract.address)

  let scenarios = [
    // Scenario.normal,                  // normal game
    // Scenario.fault,                   // illegal fault proof
    // Scenario.fraud | Scenario.fault,  // legal fault proof
    // Scenario.slash,                   // illegal slash
    // Scenario.bail | Scenario.slash,   // legal slash (always check incorrect player slash too)
    // Scenario.bail | Scenario.fraud,   // player 1 is cheating & was AFK long time but player 2 did not report
    Scenario.fraud | Scenario.fault | Scenario.bail | Scenario.slash, // all hell breaks loose
  ]

  for (let i = 0; i < scenarios.length; i++) {
    console.log('\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\n')

    game.setup(signers[0], signers[1])

    let scenario = scenarios[i]
    console.log('next scenario to play:', get_config_string(scenario))
    await game.simulate(scenario)
    console.log('previous scenario played:', get_config_string(scenario))
  }
}

//print_config()
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
.then(() => {
  //print_config()
  console.log('done!')
})
