# **PROVABLY FAIR PLAYGROUND**

Welcome. This repo is a playground for on-chain and off-chain fair gaming concepts!

Alternative names:

- Provably Fair Games, **PFG**
- Cryptographically Secure Games, **CSG**
- Cryptographically Fair Games, **CFG**
  - that's my favorite (but also means many other things)
- On-n-Off-Chain Games, O&OcG or O&OG, OOG, **On-n-Off Games**, On&Off Games
  - also really like this one
- Optimistically Proven Games, **OPG** or **OP** Games
  - that's really catchy too


# Provably Fair Battleships

Let's implement the classic game *Battleships*.

## modifications

some modifications are either necessary or desired to create on-chain battleships.

- board size 16x16 (so 256 cells can be represented in uint8)
- only one ship of each size
- additional ship of size 6
- additional non-ship item of size 1x1
  - this item gives opponent special powers
  - game will still end even if item was not discovered
  - could have additional 2 items: one with good effects and another with bad effects (e.g. shield protects = good vs. fuel explodes = bad)


## IDEA #1: on-chain flow

  1. open room -> wait for opponent
  2. join room -> can both(?) start game
    (could do syn-synack-ack flow)
    (open = syn, join = synack, start = ack)
    (open with room id, join room with merkle, start with merkle)
  3. merkle root of (board + random salt) (where board is 0/1 if ship/noship)
  each play (or both play at the same time? half duplex vs full duplex)
    play with missile coordinate
    (again could be syn-synack?)
  or could also play off-chain with "blockchain"
    each play is signed and result is shown on-chain in the end
  4. either winner sends result or fault proof


### IDEA #2: simplified on-chain flow:

1. both players choose board and agree on opponent (0x0 for any)
2. every 5 or 10 seconds players may choose a location to drop bombs (or randomally if not)
3. 

### IDEA #3: simplified off-chain flow:

1. both players choose board
2. every 5 or 10 seconds players may choose a location to drop bombs (or randomally if not)
3. 

## verification:

- time must move forward
- plays were not dropped
- ships must be well-formed (all ships have proper sizes, non-adjacent?)
  - no missing ships, no extra ships
  - proofs correspond to committed root (can be done off-chain)
- cheating can be proved per transition, no need to prove entire game
- players must call out when ship destroyed
  - prove fraud if there's an acknowledged state where ship is sunk but not called out.

## communication channel:

- must be agreed beforehand
- cannot be censored, must be stable
- no dos, no frontrunning

## communication:

- player 1 sends signed move hash
- player 2 acknowledges move hash

next message = [syn player 1 move hash #3] [ack player 2 move hash #2] [player 1 move #1]
64 bytes sync header
hash can be a rolling hash

or maybe:
[opcode byte] [data...]

    opcodes: (as 8-bits mask)
      00 - stop, no-op
      01 - syn
      02 - ack
      03 - synack
      04 - include move
      ..
      ff - all actions
