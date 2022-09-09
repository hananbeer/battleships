import hre from 'hardhat'

export const k256 = hre.ethers.utils.keccak256
export const sleep = ms => new Promise(r => setTimeout(r, ms))

export async function fast_forward(blocks) {
  let txns = []
  for (let i = 0; i < blocks; i++) {
    txns.push(
      hre.network.provider.send('evm_mine', [])
    )
  }
  return Promise.all(txns)
}

export async function deploy_contract(name) {
  const Factory = await hre.ethers.getContractFactory(name)
  contract = await Factory.deploy()

  return contract.deployed()
}

// hash two adjacent elements and returns a list, half the size, of the concatted hashes
function hash_reduce(list) {
  let hashes = []
  for (let i = 0; i < list.length; i += 2) {
    // make 64-bytes preimage (list already hex-encoded, so only remove second '0x' and do normal string concat)
    let bytes = list[i] + list[i+1].substr(2)
    hashes.push(k256(bytes))
  }
  
  return hashes
}

export function make_merkle_tree(board) {
  // basically 8 because 2^8 = 256 which is the board size in use
  // but let prepare for arbitrary size
  const ceil = Math.ceil(Math.log2(board.length))
  let hashes = []
  // tree is built in reverse. populate tree with raw values leaves and their hashes
  let tree = [board, hashes]
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

export function make_proof(merkle_tree, index) {
  // at each node i, bring hash i and adjacent hash at i^1
  //     root
  //   0      1
  // 00 01  10 11
  // ............

  // the leaves at the last level contain raw values, not hashes
  // and their direct parents are their hashes, hence the -1
  let height = merkle_tree.length - 1
  let value = merkle_tree[height][index]
  let proof = []
  
  // skip the value's hash since it will be calculated from the value
  height--

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

export function verify_merkle(root, value, proof) {
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

export function make_board(ships, salt=0) {
  let board = []
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

export function draw_board(ships, missiles=[]) {
  let output = 'x 0 1 2 3 4 5 6 7 8 9 a b c d e f'
  for (let i = 0; i < 0x100; i++) {
    if (i % 0x10 == 0)
      output += '\n' + (i/0x10).toString(16).toUpperCase() + '|'

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
  const salt = Math.floor(Math.random() * 0x7fffff/*0x3fffffff*/)
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
