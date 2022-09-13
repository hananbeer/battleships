import hre from 'hardhat'
import Player from './player.mjs'
import { fast_forward, draw_board, sleep } from './utils.mjs'

const TEST_SALT_FRAUD = false

const Scenario = {
  normal:     0x00,
  fraud:      0x01,
  fault:      0x02,
  bail:       0x04,
  slash:      0x08,
  drop_round: 0x10
}

const ScenarioStrings = {
  0x00: 'normal',
  0x01: 'fraud',
  0x02: 'fault',
  0x04: 'bail',
  0x08: 'slash',
  0x10: 'drop_round'
}

function get_config_string(scenario) {
  if (scenario == 0)
    return ScenarioStrings[0]

  let scenarios = []
  for (let i = 0; i < Object.keys(ScenarioStrings).length - 1; i++) {
    if ((scenario & (1 << i)) != 0)
      scenarios.push(ScenarioStrings[1 << i])
  }

  return scenarios.join(', ')
}

class GameSimulator {
  async deploy() {
    this.game_id = -1

    const Factory = await hre.ethers.getContractFactory("Battleships")
    this.contract = await Factory.deploy()
  
    return this.contract.deployed()
  }

  setup(signer1, signer2) {
    this.player1 = new Player(this.contract, signer1)
    this.player2 = new Player(this.contract, signer2)
  }

  async simulate_player1(round, do_fraud) {
    // player 1 is sophisticated.
    // he may or may not cheat.
    // he got intel on ships.
    // he obfuscates this fact by hitting only 50% of the time.
    let m1 = (round % 2 != 0 ? this.player2.ships[round >> 1] : (this.player2.ships[round >> 1] + 11) & 0xff) // player 1 hits 50% of the time.

    // TODO: get last missile from emitted event
    let m2 = this.player2.last_shot()
    let is_p2_hit = (this.player1.ships.indexOf(m2) != -1)
    return this.player1.play(m1, do_fraud ? false : is_p2_hit) // player 1 may or may not cheat.
  }

  async simulate_player2(round, do_fraud) {
    // player 2 is naive.
    // he shoots in order.
    // he always reports honestly.
    // he also always loses.
    let m2 = round + 1 // player 2 shoots in order.
    let m1 = this.player1.last_shot()
    let is_p1_hit = (this.player2.ships.indexOf(m1) != -1)
    return this.player2.play(m2, is_p1_hit) // player 2 always honest.
  }

  async try(promise, description, expect) {
    try {
      console.log(description)
      await promise
      if (!expect)
        console.log('PASS (success)')
      else
        console.warn('\tFAIL:', expect)
    } catch (e) {
      console.log('expect:', expect)
      let result = e.message.slice(72, -1)
      if (result == expect)
        console.log('PASS (revert)')
      else
        console.warn('\tFAIL:', e.message)
    }
  }

  async simulate(scenario, verbose=false) {
    // config
    const do_fraud = ((scenario & Scenario.fraud) != 0)
    const do_fault = ((scenario & Scenario.fault) != 0)
    const do_slash = ((scenario & Scenario.slash) != 0)
    const do_bail = ((scenario & Scenario.bail) != 0)
    const do_drop_round = ((scenario & Scenario.drop_round) != 0)

    const verbose_print = (verbose ? console.log : (x) => {})

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

    const salt1 = 0x100
    const salt2 = 0x200

    // setup
    this.player1.setup(ships1, salt1)
    this.player2.setup(ships2, salt2)

    // open
    verbose_print('open: player 1 created new game room')
    await this.player1.open()
    this.game_id++ // starts at -1
  
    // join
    verbose_print('join: player 2 joined the game room & ready')
    await this.player2.join(this.game_id)
  
    // TODO: test shuffle before & after start
  
    // start
    verbose_print('start: player 1 start & fire first shot')
    await this.player1.start(0x00)
  
    // play
    let promises = []
    // player 2 should make final round, and since player 1 made first move at start()
    // play once for player 2 before the loop
    promises.push(this.simulate_player2(0, false))
    for (let i = 1; i < (do_drop_round ? 2 : 40); i++) {
      promises.push(this.simulate_player1(i, do_fraud))
      promises.push(this.simulate_player2(i, false))
      if (verbose) {
        console.log(`move ${i}: player 1`)
        draw_board(this.player1.ships, this.player2.missiles)
        console.log(`move ${i}: player 2`)
        draw_board(this.player2.ships, this.player1.missiles)
        if (scenario == 0)
          await sleep(i < 10 ? 1500 : 50)
      }
    }
  
    await Promise.all(promises)
  
    // end
    // _end() was called by last play() of player2 which is playing honest
  
    // -- finale --

    // slash
    if (do_slash) {
      await this.try(
        this.player1.slash(),
        'slash: player 1 trying to slash illegaly during their own turn',
        'cannot slash during your turn'
      )
  
      // player2 played last by reporting loss and ending game
      // hence player2 may slash player1 (if slashing conditions met)
      if (do_bail) {
        console.log('bail: time traveling...')
        await fast_forward(101)

        await this.try(
          this.player2.slash(),
          'slash: player 2 trying slash legally',
          null
        )
      } else {
        await this.try(
          this.player2.slash(),
          'slash: player 2 trying slash prematurely',
          'not yet slashable'
        )
      }
    }
  
    // attest
    // NOTE: there's another type of fraud that can be tested here - providing incorrect salt
    let attest_salt = this.player1.salt ^ (TEST_SALT_FRAUD && do_fraud ? 1 : 0)
    await this.try(
      this.player1.game.attest(this.player1.ships, attest_salt),
      'attest: player 1 committed to tell the truth, the whole truth and nothing but the truth',
      ((do_bail && do_slash) || do_drop_round) ? 'invalid state for attest' : null
    )

    // fault
    if (do_fault) {
      let expect_fault = null
      if (do_bail && do_slash)
        expect_fault = 'invalid state for fault'
      else if (!do_fraud)
        expect_fault = 'no fault'

      await this.try(
        this.player2.game.fault(this.game_id),
        'fault: player 2 proving player 1 fraud moves',
        expect_fault
      )
    }

    // claim
    console.log('claim: time traveling...')
    await fast_forward(101)

    let expect_claim = null
    if ((do_bail && do_slash) || (do_fraud && do_fault) || do_drop_round)
    expect_claim = 'invalid state for claim'

    await this.try(
      this.player1.game.claim(this.game_id),
      'claim: player 1 claiming reward',
      expect_claim
    )
  }
}

async function run_tests() {
  let simulator = new GameSimulator()

  // setup
  let signers = await hre.ethers.getSigners()
  if (signers.length < 2) {
    console.warn('required at least 2 accounts (signers) to play')
    return
  }

  console.log('deploying game...')
  await simulator.deploy()
  console.log('deployed:', simulator.contract.address)

  let scenarios = [
    Scenario.normal,                  // normal game
    Scenario.drop_round,              // some rounds were "dropped" (think blockchain re-org)
    // Scenario.fault,                   // illegal fault proof
    Scenario.fraud | Scenario.fault,  // legal fault proof
    Scenario.slash,                   // illegal slash
    Scenario.bail | Scenario.slash,   // legal slash (always check incorrect player slash too)
    // Scenario.bail | Scenario.fraud,   // player 1 is cheating & was AFK long time but player 2 did not report
    Scenario.fraud | Scenario.fault | Scenario.bail | Scenario.slash, // all hell breaks loose
  ]

  for (let i = 0; i < scenarios.length; i++) {
    console.log('\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\n')

    simulator.setup(signers[0], signers[1])

    let scenario = scenarios[i]
    console.log('next scenario to play:', get_config_string(scenario))
    await simulator.simulate(scenario, true)
    console.log('previous scenario played:', get_config_string(scenario))
  }
}

async function main() {
  // test_merkle(500)
  // return
  await run_tests()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
.then(() => {
  console.log('done!')
})
