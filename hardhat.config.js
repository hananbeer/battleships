require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.9",
  networks: {
    goerli: {
      url: 'https://goerli.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161',
      accounts: [
        // ..
        '0x5678567856785678567856785678567856785678567856785678567856785678',
        '0x5678567856785678567856785678567856785678567856785678567856785679'
      ]
    }
  },
  //defaultNetwork: 'goerli'
};
