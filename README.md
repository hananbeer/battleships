# Battleships On-Chain

In this classic board game each player has a checkerboard as shown in the picture.

![Battleships](/battleships.png)

Players place several battleships of various sizes in secret locations on the board, as shown in gray.
During each turn, a player chooses a coordinate to “shoot”, for example C4 in the example image above, and the opponent must tell if it was a hit or a miss.

Of course there’s this *small* issue of trust - what if my opponent decides to cheat,
and simply lie whenever I hit their battleships?

So we say ok let’s just throw it on the blockchain, blockchains are trustless and problem solved.
Except (!) the blockchain is a public database, and if we try to encode the game state
on the blockchain, any player can see the other players’ battleship locations
and that wouldn’t be a very interesting game.

So we need to:
1. remove players trust requirement
2. encode the game on the blockchain without revealing the locations.

Naturally in 2022 we say “let’s throw ZKP at it”, and problem solved, again. Yes I know Zero-Knowledge Proofs are very sexy, black magic voodoo (but sexy nonetheless), however I want to show how I implemented this game in a more straightforward way.

