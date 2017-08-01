const Participation = artifacts.require('./Participation.sol');
const RiskMgmt = artifacts.require('./RiskMgmt.sol');
const RMLiquididtyProvider = artifacts.require('./RMLiquididtyProvider.sol');
const Rewards = artifacts.require('./Rewards.sol');

const managementRewardRate = 0; // Reward rate in referenceAsset per delta improvment
const performanceRewardRate = 0; // Reward rate in referenceAsset per managed seconds


module.exports = async (deployer, network) => {
  try {
    await deployer.deploy(Participation);
    await deployer.deploy(Rewards, managementRewardRate, performanceRewardRate);
    if (network === 'development') {
      await deployer.deploy(RiskMgmt);
    }
    if (network === 'kovan') {
      await deployer.deploy(RMLiquididtyProvider);
    }
  } catch (e) {
    throw e;
  }
};
