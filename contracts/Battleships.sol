// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

// Uncomment this line to use console.log
import "hardhat/console.sol";

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

        uint256 attested_root;
        uint256 attested_salt;
        uint8[] attested_coords;

        // TODO: allow configs such as board size (num cells = size x size), num ships, etc.
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

    function get_game_id() public view returns (uint256) {
        return players[msg.sender].game_id;
    }

    function _game() internal view returns (Game storage) {
        // TODO: bound checks
        return games[get_game_id()];
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

    function _init_player(uint256 game_id, uint256 board_merkle_root) internal {
        uint8[] memory arr;
        players[msg.sender] = Player({
            game_id: game_id,
            board_merkle_root: board_merkle_root,
            last_update_block: block.number,
            missiles: arr,
            acks: arr
        });
    }

    // called by player 1
    function open(uint256 board_merkle_root) public returns (uint256) {
        uint256 game_id = games.length;
        uint8[] memory empty;

        games.push(Game(
            game_id,        // game_id
            msg.sender,     // player1
            address(0x0),   // player2
            GameState.Open, // state
            0,              // start_block
            0x0,            // attested_root
            0x0,            // attested_salt
            empty           // attested_coords
        ));

        _init_player(game_id, board_merkle_root);
        return game_id;
    }

    // called by player 2
    function join(uint256 game_id, uint256 board_merkle_root) public /*returns (address)*/ {
        Game storage game = games[game_id];
        require(game.player1 != address(0x0), "room not open");
        require(game.player2 == address(0x0), "room full");
        game.state = GameState.Joined; // note no state check because game.player2 == 0 is kind of the check
        game.player2 = msg.sender;
        _init_player(game_id, board_merkle_root);
        //return game.player1;
    }

    // for ease of use open() & join() accept merkle roots which may represent
    // a random board state. while game hasn't started, allow players to
    // remix their board to their liking.
    function shuffle(uint256 board_merkle_root) public {
        require(_game().state < GameState.Started, "too late to shuffle");
        _player().board_merkle_root = board_merkle_root;
    }

    function start(uint8 coord) public returns (bool started) {
        Game storage game = _game();
        require(game.state == GameState.Joined, "invalid state for start");

        Player storage player = _player();
        player.last_update_block = block.number;
        // technically not really needed since the last player to call start()
        // will have their last_update_block be greater
        // and in play() the lower last_update_block player has the right to move next
        if (block.number - _opponent().last_update_block > MAX_BLOCKS_HIGH_AND_DRY) {
            //emit PlayerReadyAgainAfterStaleGame(..);
            return false;
        }

        player.missiles.push(coord);
        game.state = GameState.Started;
        game.start_block = block.number;
        //emit GameStarted(game_id(), block.number, merkle_root1, merkle_root2);
        // both players may now call Play()
        return true;
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
        if (opponent.missiles.length > 0 && opponent_ack) {
            // acks are indices to missiles that hit
            player.acks.push(uint8(opponent.missiles.length - 1));
            //uint8 opponent_coord = opponent.missiles[opponent.missiles.length - 1];
            //emit MissileHit(game_id(), opponent_coord);

            if (player.acks.length == MAX_SHIP_CELLS) {
                // TODO: this should be public and up to player frontend to call, probably?
                // (it's probably cleaner code too; it also allows any player to forfeit at any time)
                // also presents a nice idea: modular logic where one game scenario forfeit is allowed
                _end(player.acks);
                // early return as this is an ack-only for the end game. (missile coord is ignored)
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
        require(game.state == GameState.Started, "invalid state for end");

        //console.log('GAME ENDED: unproved loser = %s', msg.sender);
        if (msg.sender == game.player2)
            console.log("player 1 wins - proof required");
        else
            console.log("player 2 wins - proof required");

        // not attempting to prove loser; forging loss will be treated as forfeit
        emit EndGame(game.id, msg.sender, coords);
        game.state = GameState.Ended;
    }
    
    // TODO: replace all coords with bytes20 (as long as using 20 ship cells; or bytes32/uint256)
    function attest(uint8[] calldata coords, uint32 salt) public {
        // TODO: store salt somewhere
        // TODO: only report remaining coords
        // TODO: try to verify coords reported were indeed the ships hit & in order!
        // TODO: idea: store ship id below salt (instead of just 0/1)
        // (this way can also verify ships positioned correctly)

        Game storage game = _game();
        // TODO: create ERC20 tokens on testnet
        // which can be bridged for ETH on arbitrum/mainnet
        require(game.state == GameState.Ended, "invalid state for attest");
        game.state = GameState.Attested;

        // only winner can attest the game
        require(_opponent().acks.length == MAX_SHIP_CELLS, "not winner");

        Player storage player = _player();
        player.last_update_block = block.number;
        // this is kinda hacky part:
        // overriding the player's acks with *all* their ship positions
        // this is sort-of ok since game has ended
        // not the cleanest solution but somewhat cheaper on gas than ther designs :)
        //player.acks = coords;
        
        game.attested_coords = coords;
        game.attested_salt = salt; // can save gas by re-using a certain slot?
        // TODO: verify root cannot be sweeped; probably not because attest() only attests current game
        // if a new game is opened, cannot attest previous game and will be slashed
        game.attested_root = player.board_merkle_root;
        //emit GameAttested(game.id, msg.sender, coords, salt)
    }

    function _verify_fault(uint8[] memory coords, uint8[] memory missiles, uint8[] memory missiles_acks, uint256 merkle_root, uint256 salt) internal pure returns (bool) {
        // TODO: maybe if salt is too big need to slash as well?
        // (might overflow or revert in that case so need to slash)

        uint256[256] memory board;

        // we shouldn't sprinkle salt on the data itself ;)
        // (note: frontend should salt the same bits)
        salt <<= 8;

        // fill salt
        for (uint256 i = 0; i < 256/*board.length*/; i++) {
            board[i] = salt;
        }

        // mark ships
        for (uint256 i = 0; i < coords.length; i++) {
            board[coords[i]] |= /*i +*/ 1;
        }

        // unmark locations where missiles did not get ack (ie. miss)
        uint256 j = 0;
        for (uint256 i = 0; i < missiles.length; i++) {
            // acks are indices to missiles
            // so missed missiles are set of (missles - acks)
            if (j < missiles_acks.length && missiles_acks[j] == i) { // missile hit, skip
                j++;
                //console.log("missile hit %s -> %s", i, missiles[i]);
                continue;
            }
            //console.log("removing missile %s -> %s", i, missiles[i]);

            //console.log("%s before: %s", i, board[missiles[i]]);
            board[missiles[i]] &= uint256(int256(-2)); // 0xff..fe, to clear least-significant bit
            //console.log("%s after: %s", i, board[missiles[i]]);
        }

        // fill hashes
        //console.log("board[0]: %s", board[0]);
        for (uint256 i = 0; i < 256/*board.length*/; i++) {
            board[i] = uint256(keccak256(abi.encode(board[i])));
        }
        //console.log("keccak256(board[0])");
        //console.logBytes32(bytes32(board[0]));

        uint256 len = 128/*board.length / 2*/;
        while (len > 0) {
            for (uint256 i = 0; i < len; i++) {
                board[i] = uint256(keccak256(abi.encode(board[2*i], board[2*i+1])));
                //console.log("%s : %s", len, i);
                //console.logBytes32(bytes32(board[i]));
            }
            //console.log("[%s] keccak256(board[0]):", len);
            //console.logBytes32(bytes32(board[0]));

            len /= 2;
        }

        return board[0] != merkle_root;
    }

    function fault(uint256 game_id) public {
        Game storage game = games[game_id];
        require(game.state == GameState.Attested, "invalid state for fault");
        game.state = GameState.Faulted;

        Player storage opponent = _opponent();
        // loosely-related check of whether caller is fault maker (attester) or fault prover
        // TODO: try to find better signal for fault detection?
        require(_player().acks.length == MAX_SHIP_CELLS, "not loser");
        //require(opponent.board_merkle_root == game.attested_root);

        // TODO: currently only verified a fake board.
        // but what if someone attests the right board but their acks
        // are fake??
        
        require(_verify_fault(game.attested_coords, _player().missiles, opponent.acks, game.attested_root, game.attested_salt), "no fault");
        
        // check if fault discovered within fraud proof window
        // even if it's too late to slash we don't revert and report fraud anyway
        //uint256 fee = 0;
        if (block.number - opponent.last_update_block < MIN_ATTESTATION_BLOCKS) {
            // TODO: implement stake
            //fee = _opponent().stake;
        }

        // TODO: prove fault here
        console.log("fault proved by: %s", msg.sender);

        //emit GameFault(game.id, msg.sender);
    }

    // TODO: add game config to require fault() before claim()
    function claim(uint256 game_id) public {
        require(block.number - _player().last_update_block > MIN_ATTESTATION_BLOCKS, "premature claim");

        Game storage game = games[game_id];
        // TODO: create ERC20 tokens on testnet
        // which can be bridged for ETH on arbitrum/mainnet
        require(game.state == GameState.Attested, "invalid state for claim");
        game.state = GameState.Claimed;

        // TODO: claim here
        console.log("claimed by: %s", msg.sender);
        //emit GameClaimed(..);
    }

    // slash if opponent hasn't played for long period
    function slash() public {
        uint256 opponent_last_update_block = _opponent().last_update_block;
        require(_player().last_update_block > opponent_last_update_block, "cannot slash during your turn");
        require(block.number - opponent_last_update_block > MAX_BLOCKS_HIGH_AND_DRY, "not yet slashable");

        Game storage game = _game();
        // TODO: should allow slashing in other states?
        require(game.state == GameState.Started || game.state == GameState.Ended, "invalid state for slash");        
        game.state = GameState.Slashed;

        // TODO: slash here
        console.log("slashed by: %s", msg.sender);

        //emit GameSlashed();
    }
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