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

    struct Player {
        uint256 game_id;
        //address player;
        uint256 board_merkle_root;
        //address opponent;
        uint256 last_move; // block.number
        uint8[] missiles;
        //bool is_playing;
    }

    enum GameState {
        None,
        Open,
        Joined,
        Started,
        Ended,
        Slashed,
        Faulted
    }

    struct Game {
        uint256 id;
        address player1;
        address player2; // thought experiment: can play larger games!
        GameState state;
        uint256 start_block; // block.number
        //uint256 start_time; // block.timestamp
    }

    Game[] public games;
    mapping (address => Player) public players;

    // about 30-45 seconds window on arbitrum
    // used to make sure no player is AFK while another tries to join
    uint256 immutable MAX_BLOCKS_HIGH_AND_DRY = 100;

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
            last_move: 0,
            missiles: arr
        });
    }

    // called by player 1
    function Open(uint256 board_merkle_root) public {
        uint256 id = games.length;
        games.push(Game(
            id,
            msg.sender,
            address(0x0),
            GameState.Open,
            0
        ));

        _init_player(board_merkle_root);
    }

    // called by player 2
    function Join(uint256 game_id, uint256 board_merkle_root) public {
        Game storage game = games[game_id];
        require(game.player1 != address(0x0), "room not open");
        require(game.player2 != address(0x0), "room full");
        game.player2 = msg.sender;
        game.state = GameState.Joined;
        _init_player(board_merkle_root);
    }

    // for ease of use Open & Join accept merkle roots which may represent
    // a random board state. while game hasn't started, allow players to
    // remix their board to their liking.
    function Shuffle(uint256 board_merkle_root) public {
        require(_game().state < GameState.Started, "too late to shuffle");
        _player().board_merkle_root = board_merkle_root;
    }

    function Start() public {
        require(_game().state < GameState.Started, "too late to shuffle");
        _player().last_move = block.number;
        uint256 opponent_last_move = _opponent().last_move;
        if (opponent_last_move == 0)
            return;
        
        // technically not really needed since the last player to call Start()
        // will have their .last_move be greater
        // and in Play() the lower .last_move player has the right to move next
        if (opponent_last_move - block.number < MAX_BLOCKS_HIGH_AND_DRY) {
            Game storage game = _game();
            game.state = GameState.Started;
            game.start_block = block.number;
            //emit GameStarted(game_id(), block.number);

            // both players may now call Play()
        }
    }

    // must be player's turn
    function Play(uint8 coord) public {
        require(_game().state == GameState.Started, "no active game");
        uint256 player_last_move = _player().last_move;
        uint256 opponent_last_move = _opponent().last_move;
        require(player_last_move < opponent_last_move, "not your turn");
        require(opponent_last_move - player_last_move < MAX_BLOCKS_HIGH_AND_DRY, "stale game");

        Player storage player = players[msg.sender];
        player.missiles.push(coord);
        // - must be turn

        _player().last_move = block.timestamp;
    }

    //  - must reveal board on-chain within 30 seconds or slash able
    function End(uint8[] calldata ships) public {

    }
    
    function Fault(bytes calldata proof) public {
    }

    function Slash() public {
        uint256 player_last_move = _player().last_move;
        uint256 opponent_last_move = _opponent().last_move;
        require(player_last_move < opponent_last_move, "not your turn");
        require(opponent_last_move - player_last_move > MAX_BLOCKS_HIGH_AND_DRY, "not slashable");

        // TODO: slash here

        _game().state = GameState.Slashed;
        //emit GameSlashed();
    }

    /*
    enum BoardPiece {
        uint8 type; //
    }

    enum CellType {
        EMPTY = 0,
        SUBMARINE = 1,
        
        uint8 from; // 0-99 as grid cell
        uint8 to; // 0-99 ^
    */


    function hash(uint256[100] calldata board) public {
        /*
               root
            c1      c2
          c3  c4  c5  c6
          NOTE: since there are onzly 100 nodes it can be fuzzed easily...  :\ even with salt
          need to randomize each value, not just salt
          on missle need to supply proof (lsb controls the bool of the board? or maybe mod X for X options)
        */
    }
}
