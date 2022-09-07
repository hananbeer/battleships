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
        //address player;
        uint256 board_merkle_root;
        //address opponent;
        uint256 last_move; // block.timestamp
        uint8[] missiles;
        bool is_playing;
    }

    mapping (address => Player) public players;

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

    // maybe not needed?
    function Open(uint256 room) public {
    }

    // maybe not needed?
    function Join(uint256 room) public {
        
    }

    // start a fully joined game
    function Start(uint256 room, uint256 board_merkle_root) public returns (uint256 game_id) {
        uint8[] memory arr;
        players[msg.sender] = Player(
            board_merkle_root,
            block.timestamp,
            arr,
            true
        );

        return block.number;
    }
    
    // must be turn
    function Play(uint256 game_id, uint8 coord) public {
        Player storage player = players[msg.sender];
        player.missiles.push(coord);
        // - must be turn
    }

    //  - must reveal board on-chain within 30 seconds or slash able
    function End(uint256 game_id, uint8[] calldata ships) public {

    }
    
    function Fault(bytes calldata proof) public {
    }

    function Slash(bytes calldata proof) public {
        // either too much time without End() called or merkle root don’t match?
        // - could just make End check merkle proof..
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

}
