import hre from 'hardhat'
import * as readline from 'node:readline'
import { stdin as input, stdout as output } from 'node:process'
const rl = readline.createInterface({ input, output })

import { draw_board } from './utils.mjs'
import Player from './player.mjs'

function random_coord() {
  return Math.floor(Math.random() * 0x100)
}

let computer_ships = []
for (let i = 0; i < 0x100; i++) {
  computer_ships.push(i)
}
computer_ships = computer_ships.sort(() => Math.random() - 0.5).slice(0, 20)
draw_board(computer_ships)

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
player.setup(computer_ships)

console.log('making room...')
await computer.open()

console.log('joining room...')
await player.join(0)

console.log('first shot...')
await computer.start(random_coord())

rl.on('line', async (coord) => {
  console.log('shooting:', coord)
  coord = parseInt(coord, 16)
  let pres = await player.play(coord, player.ack(computer.last_shot()))

  let computer_coord = random_coord()
  let cres = await computer.play(computer_coord, computer.ack(player.last_shot()))
  
  //draw_board(player_ships, computer.missiles)
  draw_board(computer_ships, player.missiles)
  console.log('computer played:', computer_coord.toString(16).padStart(2, '0'))
})

