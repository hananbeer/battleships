// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

// Uncomment this line to use console.log
import "hardhat/console.sol";

/*library Coordinates {

}*/

contract Battleships {
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    receive() external payable {
    }

    enum GameState {
        None,     // no game
        Open,     // player 1 opened room
        Joined,   // player 2 joined player 1 (one or neither requested to start)
        Started,  // both players started game
        Ended,    // first player to report loss
        Attested, // winner attested their board
        Slashed,  // afk player slashed, game is sealed and no further actions can be taken
        Faulted,  // player proved fault, game is sealed and no further actions can be taken
        Claimed   // winner claimed funds, game is sealed and no further actions can be taken
    }

    struct Game {
        uint256 id;
        address player1;
        address player2; // thought experiment: can play larger games!
        GameState state;
        uint256 start_block; // block.number
        //uint256 start_time; // block.timestamp
    }

    struct Player {
        uint256 game_id;
        //address player;
        uint256 board_merkle_root;
        //address opponent;
        uint256 last_update_block; // block.number
        uint8[] missiles;
        uint8[] acks;
        //bool is_playing;
    }

    Game[] public games;
    mapping (address => Player) public players;

    // ships of sizes 2+3+4+5+6 = 20 acks to win game
    uint256 immutable MAX_SHIP_CELLS = 20;

    // about 30-45 seconds window on arbitrum
    // used to make sure no player is AFK while another tries to join
    uint256 immutable MAX_BLOCKS_HIGH_AND_DRY = 100;

    // about 3000-4500 seconds or roughly an hour
    uint256 immutable MIN_ATTESTATION_BLOCKS = 100;//00;

    function _game_id() internal view returns (uint256) {
        return players[msg.sender].game_id;
    }

    function _game() internal view returns (Game storage) {
        // TODO: bound checks
        return games[_game_id()];
    }

    function _player() internal view returns (Player storage) {
        return players[msg.sender];
    }

    function _opponent() internal view returns (Player storage) {
        Game storage game = _game();
        if (game.player1 == msg.sender)
            return players[game.player2];
        else if (game.player2 == msg.sender)
            return players[game.player1];
        else
            revert("no opponent");
    }

    function _init_player(uint256 board_merkle_root) internal {
        uint8[] memory arr;
        players[msg.sender] = Player({
            game_id: _game_id(),
            board_merkle_root: board_merkle_root,
            last_update_block: 0,
            missiles: arr,
            acks: arr
        });
    }

    // called by player 1
    function open(uint256 board_merkle_root) public returns (uint256) {
        uint256 id = games.length;
        games.push(Game(
            id,
            msg.sender,
            address(0x0),
            GameState.Open,
            0
        ));

        _init_player(board_merkle_root);
        return id;
    }

    // called by player 2
    function join(uint256 game_id, uint256 board_merkle_root) public {
        Game storage game = games[game_id];
        require(game.player1 != address(0x0), "room not open");
        require(game.player2 == address(0x0), "room full");
        game.player2 = msg.sender;
        game.state = GameState.Joined;
        _init_player(board_merkle_root);
    }

    // for ease of use Open & Join accept merkle roots which may represent
    // a random board state. while game hasn't started, allow players to
    // remix their board to their liking.
    function shuffle(uint256 board_merkle_root) public {
        require(_game().state < GameState.Started, "too late to shuffle");
        _player().board_merkle_root = board_merkle_root;
    }

    function start(uint8 coord) public {
        require(_game().state < GameState.Started, "too late to shuffle");
        Player storage player = _player();
        if (player.missiles.length == 0)
            player.missiles.push(coord);
        else
            player.missiles[0] = coord;

        player.last_update_block = block.number;
        uint256 opponent_last_update_block = _opponent().last_update_block;
        if (opponent_last_update_block == 0)
            return;
        
        // technically not really needed since the last player to call Start()
        // will have their .last_update_block be greater
        // and in Play() the lower .last_update_block player has the right to move next
        if (block.number - opponent_last_update_block < MAX_BLOCKS_HIGH_AND_DRY) {
            Game storage game = _game();
            game.state = GameState.Started;
            game.start_block = block.number;
            //emit GameStarted(game_id(), block.number);
            // both players may now call Play()
        }
    }

    // must be player's turn
    function play(uint8 coord, bool opponent_ack) public {
        Game storage game = _game();
        require(game.state == GameState.Started, "no active game");
        Player storage player = _player();
        Player storage opponent = _opponent();

        uint256 player_last_update_block = player.last_update_block;
        uint256 opponent_last_update_block = opponent.last_update_block;
        require(player_last_update_block < opponent_last_update_block, "not your turn");
        require(opponent_last_update_block - player_last_update_block < MAX_BLOCKS_HIGH_AND_DRY, "stale game");

        player.last_update_block = block.number;

        // opponent_ack is player acknowledgment of player missile
        // at the end of the game proofs should be published
        if (opponent_ack) {
            uint8 opponent_coord = opponent.missiles[opponent.missiles.length - 1];
            player.acks.push(opponent_coord);
            //emit MissileHit(_game_id(), opponent_coord);

            if (player.acks.length == MAX_SHIP_CELLS) {
                _end(player.acks);
                // early return as this is an ack-only for the end game.
                // it should be generated automatically by frontend
                // but if not, player will be slashable or faulted
                // soon enough.
                return;
            }
        }

        player.missiles.push(coord);
    }

    event EndGame(uint256 indexed game_id, address player, uint8[] coords);

    // must reveal board on-chain within 30 seconds or slash able
    function _end(uint8[] memory coords) internal {
        Game storage game = _game();
        require(game.state == GameState.Started, "invalid end state");

        console.log('GAME ENDED: unproved loser = %s', msg.sender);
        // not attempting to prove loser; forging loss will be treated as forfeit
        emit EndGame(game.id, msg.sender, coords);
        game.state = GameState.Ended;
    }
    
    function attest(uint8[] calldata coords, uint32 salt) public {
        Game storage game = _game();
        // TODO: create ERC20 tokens on testnet
        // which can be bridged for ETH on arbitrum/mainnet
        require(game.state == GameState.Ended, "invalid attest state");
        game.state = GameState.Attested;
        _player().last_update_block = block.number;
    }

    function fault(uint256 game_id, uint32 salt) public {
        Game storage game = games[game_id];
        require(game.state == GameState.Attested, "invalid fault state");
        // loosely-related check of whether caller is fault maker (attester) or fault prover
        require(_player().acks.length == MAX_SHIP_CELLS, "not attester");

        // TODO: prove fault here
        console.log("fault proved by: %s", msg.sender);

        game.state = GameState.Faulted;
        //revert("unimplemented");
    }

    function claim(uint256 game_id) public {
        Game storage game = games[game_id];
        // TODO: create ERC20 tokens on testnet
        // which can be bridged for ETH on arbitrum/mainnet
        require(game.state == GameState.Attested, "invalid game state");
        require(block.number - _player().last_update_block > MIN_ATTESTATION_BLOCKS, "premature claim");

        // TODO: claim here
        console.log("claimed by: %s", msg.sender);

        game.state = GameState.Claimed;
        //revert("unimplemented");
    }

    // slash if opponent hasn't played for long period
    function slash() public {
        Game storage game = _game();
        // TODO: should allow slashing in other states?
        require(game.state == GameState.Started || game.state == GameState.Ended, "invalid slash state");
        
        uint256 opponent_last_update_block = _opponent().last_update_block;
        require(_player().last_update_block > opponent_last_update_block, "not your turn");
        require(block.number - opponent_last_update_block > MAX_BLOCKS_HIGH_AND_DRY, "not slashable");

        // TODO: slash here
        console.log("slashed by: %s", msg.sender);

        game.state = GameState.Slashed;
        //emit GameSlashed();
        //revert("unimplemented");
    }

    /*function hash(uint256[100] calldata board) public {
        
               root
            c1      c2
          c3  c4  c5  c6
          NOTE: since there are onzly 100 nodes it can be fuzzed easily...  :\ even with salt
          need to randomize each value, not just salt
          on missle need to supply proof (lsb controls the bool of the board? or maybe mod X for X options)
        
    }*/
}

/*
security checklist:
- check all state transitions
    - get state & verified correctly everywhere
    - set correct game state at correct position
    - set correct last updates
- proofs are good
- ?
*/