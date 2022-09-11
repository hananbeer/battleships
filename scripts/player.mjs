
import { make_board, make_merkle_tree } from './utils.mjs'

export default class Player {
  constructor(game_contract, signer) {
    this.game = game_contract.connect(signer)
    this.address = signer.address
  }

  // TODO: remove need for first_shot
  setup(ships, salt) {
    //console.log(`preparing player ${this.id} @ ${this.address}`)
    if (!salt)
      salt = parseInt(Math.random() * 0x7fffff)

    this.salt = salt
    this.ships = ships
    this.board = make_board(ships, salt)
    this.merkle = make_merkle_tree(this.board)
    this.merkle_root = this.merkle[0][0]
    this.missiles = []
    //console.log(`player ${this.id} merkle root: ${this.merkle_root}`)
  }

  last_shot() {
    return this.missiles[this.missiles.length - 1]
  }

  ack(coord) {
    return (this.board[coord] & 0x01) == 1
  }

  async open() {
    return this.game.open(this.merkle_root)
  }

  async join(game_id) {
    return this.game.join(game_id, this.merkle_root)
  }

  async start(missile_coord) {
    this.missiles = []
    if (missile_coord === undefined)
      missile_coord = 0
    else
      this.missiles.push(missile_coord)

    return this.game.start(missile_coord)
  }

  async game_state() {
    return this.game.callStatic.game_state()
  }

  async play(player_coord, opponent_ack) {
    this.missiles.push(player_coord)
    await this.game.play(player_coord, opponent_ack)

    let game_state = await this.game_state()
    return (game_state == 3)
  }

  async slash() {
    return this.game.slash()
  }

  async attest() {
    return this.game.attest(this.ships, this.salt)
  }

  async fault(game_id) {
    return this.game.fault(game_id)
  }

  async claim(game_id) {
    if (!game_id)
      game_id = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'

    return this.game.claim(game_id)
  }
}
