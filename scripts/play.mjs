console.log('initializing...')

import hre from 'hardhat'
import * as readline from 'readline'
import { stdin as input, stdout as output } from 'node:process'
const rl = readline.createInterface({ input, output })

import { draw_board, fast_forward } from './utils.mjs'
import Player from './player.mjs'

function random_coord() {
  return Math.floor(Math.random() * 0x100)
}

let computer_ships = []
const strict_size = 5
for (let i = 0; i < 0x100; i++) {
  if ((i & 0x0f) < strict_size && (i & 0xf0) < (strict_size << 4))
    computer_ships.push(i)
}
computer_ships = computer_ships.sort(() => Math.random() - 0.5).slice(0, 20)
//draw_board(player_ships)

const player_ships = [
  0x11, 0x12,                   // B2-C2 destroyer
  0x32,                         // C4    submarine
  0x44, 0x54,                   // E4-E5
  0x36, 0x46, 0x56,             // G3-G5
  0x17,                         // I2
  0x84, 0x85, 0x86, 0x87,       // E8-H8
  0xA1, 0xA2, 0xA3, 0xA4, 0xA5, // B10-F10
  0xFE, 0xFF
]

let signers = await hre.ethers.getSigners()
if (signers.length < 2) {
  console.warn('required at least 2 accounts (signers) to play')
  exit(0)
}

const Factory = await hre.ethers.getContractFactory("Battleships")
const game = await Factory.deploy()
await game.deployed()

let computer = new Player(game, signers[0])
computer.setup(computer_ships)

let player = new Player(game, signers[1])
player.setup(player_ships)

console.log('making room...')
await computer.open()

console.log('joining room...')
await player.join(0)

console.log('first shot...')
await computer.start(random_coord())

let user_visible_ships = []

let GameStates = {
  0: 'None',     // no game
  1: 'Open',     // player 1 opened room
  2: 'Joined',   // player 2 joined player 1 (one or neither requested to start)
  3: 'Started',  // both players started game
  4: 'Ended',    // first player to report loss
  5: 'Attested', // winner attested their board
  6: 'Slashed',  // afk player slashed, game is sealed and no further actions can be taken
  7: 'Faulted',  // player proved fault, game is sealed and no further actions can be taken
  8: 'Claimed'   // winner claimed funds, game is sealed and no further actions can be taken
}

console.log('play:')

let lines = [
  '00','01','02','03','04',
  '10','11','12','13','14',
  '20','21','22','23','24',
  '30','31','32','33','34',
  '40','41','42','43','44'
]
const simulate_win = false
while (lines.length > 0) {
  //let line = await ask()
  let line = lines.pop()
  let coord = parseInt(line, 16)
  if (isNaN(coord)) {
    console.log('bad input. try again')
    continue
  }

  if (coord < 0 || coord > 0x100) {
    console.log('out of bounds. be nice')
    continue
  }

  if (player.missiles.indexOf(coord) != -1) {
    console.log('already shot. choose new')
    continue
  }

  //rl.pause()

  console.log('shooting:', coord.toString(16).padStart(2, '0'))
  let move_success = await player.play(coord, player.ack(computer.last_shot()))
  if (!move_success) {
    console.log('* YOU LOSE :( *')

    console.log('attesting game...')
    await computer.attest()
    console.log('waiting for unlock...')
    await fast_forward(101)
    console.log('claiming...')
    await computer.claim()
    console.log('reward claimed!')
    break
  }

  let computer_coord = (simulate_win ? random_coord() : player_ships[24 - lines.length])
  move_success = await computer.play(computer_coord, computer.ack(player.last_shot()))
  if (computer.ack(player.last_shot()))
    user_visible_ships.push(player.last_shot())
  //draw_board(player_ships, computer.missiles)
  draw_board(user_visible_ships, player.missiles)
  if (!move_success) {
    console.log('* * * YOU WIN!!! * * *')
    console.log('attesting game...')
    await player.attest()
    console.log('waiting for unlock...')
    await fast_forward(101)
    console.log('claiming...')
    await player.claim()
    console.log('reward claimed!')
    break
  }

  console.log('computer played:', computer_coord.toString(16).padStart(2, '0'))
  //rl.resume()
}

console.log('done!')

