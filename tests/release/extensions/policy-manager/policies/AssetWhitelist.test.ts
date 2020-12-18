import { EthereumTestnetProvider, randomAddress } from '@crestproject/crestproject';
import {
  addTrackedAssetsArgs,
  addTrackedAssetsSelector,
  AssetWhitelist,
  assetWhitelistArgs,
  callOnIntegrationArgs,
  ComptrollerLib,
  Dispatcher,
  IntegrationManagerActionId,
  PolicyHook,
  policyManagerConfigArgs,
  validateRulePostCoIArgs,
  VaultLib,
} from '@melonproject/protocol';
import {
  assertEvent,
  createFundDeployer,
  createMigratedFundConfig,
  createNewFund,
  defaultTestDeployment,
  transactionTimestamp,
} from '@melonproject/testutils';
import { constants, utils } from 'ethers';

async function snapshot(provider: EthereumTestnetProvider) {
  const { accounts, deployment, config } = await defaultTestDeployment(provider);

  const [EOAPolicyManager, ...remainingAccounts] = accounts;

  const assetWhitelist1 = await AssetWhitelist.deploy(config.deployer, EOAPolicyManager);
  const unconfiguredAssetWhitelist = assetWhitelist1.connect(EOAPolicyManager);

  const denominationAssetAddress = randomAddress();
  const whitelistedAssets = [denominationAssetAddress, randomAddress(), randomAddress()];

  // Mock the ComptrollerProxy and VaultProxy
  const mockVaultProxy = await VaultLib.mock(config.deployer);
  await mockVaultProxy.getTrackedAssets.returns([]);

  const mockComptrollerProxy = await ComptrollerLib.mock(config.deployer);
  await mockComptrollerProxy.getDenominationAsset.returns(denominationAssetAddress);

  await mockComptrollerProxy.getVaultProxy.returns(mockVaultProxy);

  const assetWhitelist2 = await AssetWhitelist.deploy(config.deployer, EOAPolicyManager);
  const configuredAssetWhitelist = assetWhitelist2.connect(EOAPolicyManager);
  const assetWhitelistConfig = assetWhitelistArgs(whitelistedAssets);

  await configuredAssetWhitelist.addFundSettings(mockComptrollerProxy, assetWhitelistConfig);

  return {
    accounts: remainingAccounts,
    config,
    configuredAssetWhitelist,
    denominationAssetAddress,
    deployment,
    mockComptrollerProxy,
    mockVaultProxy,
    unconfiguredAssetWhitelist,
    whitelistedAssets,
  };
}

describe('constructor', () => {
  it('sets state vars', async () => {
    const {
      deployment: { policyManager, assetWhitelist },
    } = await provider.snapshot(snapshot);

    const getPolicyManagerCall = await assetWhitelist.getPolicyManager();
    expect(getPolicyManagerCall).toMatchAddress(policyManager);

    const implementedHooksCall = await assetWhitelist.implementedHooks();
    expect(implementedHooksCall).toMatchObject([PolicyHook.PostCallOnIntegration]);
  });
});

describe('addFundSettings', () => {
  it('can only be called by the PolicyManager', async () => {
    const {
      deployment: { assetWhitelist },
      mockComptrollerProxy,
      whitelistedAssets,
    } = await provider.snapshot(snapshot);

    const assetWhitelistConfig = assetWhitelistArgs(whitelistedAssets);

    await expect(assetWhitelist.addFundSettings(mockComptrollerProxy, assetWhitelistConfig)).rejects.toBeRevertedWith(
      'Only the PolicyManager can make this call',
    );
  });

  it('requires that the denomination asset be whitelisted', async () => {
    const {
      unconfiguredAssetWhitelist,
      denominationAssetAddress,
      mockComptrollerProxy,
      whitelistedAssets,
    } = await provider.snapshot(snapshot);

    const assetWhitelistConfig = assetWhitelistArgs(
      whitelistedAssets.filter((asset) => asset != denominationAssetAddress),
    );

    await expect(
      unconfiguredAssetWhitelist.addFundSettings(mockComptrollerProxy, assetWhitelistConfig),
    ).rejects.toBeRevertedWith('Must whitelist denominationAsset');
  });

  it('sets initial config values for fund and fires events', async () => {
    const { unconfiguredAssetWhitelist, whitelistedAssets, mockComptrollerProxy } = await provider.snapshot(snapshot);

    const assetWhitelistConfig = assetWhitelistArgs(whitelistedAssets);
    const receipt = await unconfiguredAssetWhitelist.addFundSettings(mockComptrollerProxy, assetWhitelistConfig);

    // Assert the AddressesAdded event was emitted
    assertEvent(receipt, 'AddressesAdded', {
      comptrollerProxy: mockComptrollerProxy,
      items: whitelistedAssets,
    });

    // List should be the whitelisted assets
    const getListCall = await unconfiguredAssetWhitelist.getList(mockComptrollerProxy);
    expect(getListCall).toMatchObject(whitelistedAssets);
  });
});

describe('updateFundSettings', () => {
  it('can only be called by the PolicyManager', async () => {
    const {
      deployment: { assetWhitelist },
    } = await provider.snapshot(snapshot);

    await expect(assetWhitelist.updateFundSettings(randomAddress(), randomAddress(), '0x')).rejects.toBeRevertedWith(
      'Updates not allowed for this policy',
    );
  });
});

describe('activateForFund', () => {
  it('does not allow a non-whitelisted asset in the fund trackedAssets', async () => {
    const {
      configuredAssetWhitelist,
      whitelistedAssets,
      mockComptrollerProxy,
      mockVaultProxy,
    } = await provider.snapshot(snapshot);

    // Activation should pass if trackedAssets are only whitelisted assets
    await mockVaultProxy.getTrackedAssets.returns(whitelistedAssets);
    await expect(configuredAssetWhitelist.activateForFund(mockComptrollerProxy, mockVaultProxy)).resolves.toBeReceipt();

    // Setting a non-whitelisted asset as a trackedAsset should make activation fail
    await mockVaultProxy.getTrackedAssets.returns([whitelistedAssets[0], randomAddress()]);
    await expect(
      configuredAssetWhitelist.activateForFund(mockComptrollerProxy, mockVaultProxy),
    ).rejects.toBeRevertedWith('Non-whitelisted asset detected');
  });
});

describe('validateRule', () => {
  it('returns true if an asset is in the whitelist', async () => {
    const {
      configuredAssetWhitelist,
      mockComptrollerProxy,
      mockVaultProxy,
      whitelistedAssets,
    } = await provider.snapshot(snapshot);

    // Only the incoming assets arg matters for this policy
    const postCoIArgs = validateRulePostCoIArgs({
      adapter: constants.AddressZero,
      selector: utils.randomBytes(4),
      incomingAssets: [whitelistedAssets[0]], // good incoming asset
      incomingAssetAmounts: [],
      outgoingAssets: [],
      outgoingAssetAmounts: [],
    });

    const validateRuleCall = await configuredAssetWhitelist.validateRule
      .args(mockComptrollerProxy, mockVaultProxy, PolicyHook.PostCallOnIntegration, postCoIArgs)
      .call();

    expect(validateRuleCall).toBe(true);
  });

  it('returns false if an asset is not in the whitelist', async () => {
    const { configuredAssetWhitelist, mockComptrollerProxy, mockVaultProxy } = await provider.snapshot(snapshot);

    // Only the incoming assets arg matters for this policy
    const postCoIArgs = validateRulePostCoIArgs({
      adapter: constants.AddressZero,
      selector: utils.randomBytes(4),
      incomingAssets: [randomAddress()], // good incoming asset
      incomingAssetAmounts: [],
      outgoingAssets: [],
      outgoingAssetAmounts: [],
    });

    const validateRuleCall = await configuredAssetWhitelist.validateRule
      .args(mockComptrollerProxy, mockVaultProxy, PolicyHook.PostCallOnIntegration, postCoIArgs)
      .call();

    expect(validateRuleCall).toBe(false);
  });
});

describe('integration tests', () => {
  it('can create a new fund with this policy, and it works correctly during callOnIntegration', async () => {
    const {
      accounts: [fundOwner],
      deployment: {
        trackedAssetsAdapter,
        integrationManager,
        fundDeployer,
        assetWhitelist,
        tokens: { weth: denominationAsset, mln: incomingAsset, comp: nonWhitelistedAsset },
      },
    } = await provider.snapshot(snapshot);

    // declare variables for policy config
    const assetWhitelistAddresses = [
      denominationAsset.address,
      incomingAsset.address,
      randomAddress(),
      randomAddress(),
    ];
    const assetWhitelistSettings = assetWhitelistArgs(assetWhitelistAddresses);
    const policyManagerConfig = policyManagerConfigArgs({
      policies: [assetWhitelist.address],
      settings: [assetWhitelistSettings],
    });

    // create new fund with policy as above
    const { comptrollerProxy, vaultProxy } = await createNewFund({
      signer: fundOwner,
      fundDeployer,
      denominationAsset,
      fundOwner,
      fundName: 'Test Fund!',
      policyManagerConfig,
    });

    // confirm a whitelisted asset is allowed
    const incomingAssetAmount = utils.parseEther('50');

    // Send incomingAsset to vault
    await incomingAsset.transfer(vaultProxy.address, incomingAssetAmount);

    // track it and expect to pass
    const whitelistedTrackedAssetArgs = addTrackedAssetsArgs([incomingAsset]);
    const whitelistedTrackedAssetCallArgs = callOnIntegrationArgs({
      adapter: trackedAssetsAdapter,
      selector: addTrackedAssetsSelector,
      encodedCallArgs: whitelistedTrackedAssetArgs,
    });

    await comptrollerProxy
      .connect(fundOwner)
      .callOnExtension(
        integrationManager,
        IntegrationManagerActionId.CallOnIntegration,
        whitelistedTrackedAssetCallArgs,
      );

    // confirm a non-whitelisted asset is not allowed
    const nonWhitelistedAssetAmount = utils.parseEther('50');

    // send non-whitelisted asset to vault
    await nonWhitelistedAsset.transfer(vaultProxy.address, nonWhitelistedAssetAmount);

    // track it and expect to fail
    const trackedAssetArgs = addTrackedAssetsArgs([nonWhitelistedAsset]);
    const trackedAssetCallArgs = callOnIntegrationArgs({
      adapter: trackedAssetsAdapter,
      selector: addTrackedAssetsSelector,
      encodedCallArgs: trackedAssetArgs,
    });

    const addTrackedAssetsTx = comptrollerProxy
      .connect(fundOwner)
      .callOnExtension(integrationManager, IntegrationManagerActionId.CallOnIntegration, trackedAssetCallArgs);

    await expect(addTrackedAssetsTx).rejects.toBeRevertedWith(
      'VM Exception while processing transaction: revert Rule evaluated to false: ASSET_WHITELIST',
    );
  });

  it('can create a migrated fund with this policy', async () => {
    const {
      accounts: [fundOwner],
      config: {
        deployer,
        integratees: {
          synthetix: { addressResolver: synthetixAddressResolverAddress },
        },
      },
      deployment: {
        chainlinkPriceFeed,
        trackedAssetsAdapter,
        dispatcher,
        feeManager,
        fundDeployer,
        integrationManager,
        permissionedVaultActionLib,
        policyManager,
        synthetixPriceFeed,
        valueInterpreter,
        vaultLib,
        assetWhitelist,
        tokens: { weth: denominationAsset, mln: incomingAsset, comp: nonWhitelistedAsset },
      },
    } = await provider.snapshot(snapshot);

    const assetWhitelistAddresses = [denominationAsset.address, incomingAsset, randomAddress(), randomAddress()];
    const assetWhitelistSettings = assetWhitelistArgs(assetWhitelistAddresses);
    const policyManagerConfig = policyManagerConfigArgs({
      policies: [assetWhitelist.address],
      settings: [assetWhitelistSettings],
    });

    // create new fund with policy as above
    const { vaultProxy } = await createNewFund({
      signer: fundOwner,
      fundDeployer,
      denominationAsset,
      fundOwner,
      fundName: 'Test Fund!',
      policyManagerConfig,
    });

    // migrate fund
    const nextFundDeployer = await createFundDeployer({
      deployer,
      chainlinkPriceFeed,
      dispatcher,
      feeManager,
      integrationManager,
      permissionedVaultActionLib,
      policyManager,
      synthetixPriceFeed,
      synthetixAddressResolverAddress,
      valueInterpreter,
      vaultLib,
    });

    const { comptrollerProxy: nextComptrollerProxy } = await createMigratedFundConfig({
      signer: fundOwner,
      fundDeployer: nextFundDeployer,
      denominationAsset,
      policyManagerConfigData: policyManagerConfig,
    });

    const signedNextFundDeployer = nextFundDeployer.connect(fundOwner);
    const signalReceipt = await signedNextFundDeployer.signalMigration(vaultProxy, nextComptrollerProxy);
    const signalTime = await transactionTimestamp(signalReceipt);

    // Warp to migratable time
    const migrationTimelock = await dispatcher.getMigrationTimelock();
    await provider.send('evm_increaseTime', [migrationTimelock.toNumber()]);

    // Migration execution settles the accrued fee
    const executeMigrationReceipt = await signedNextFundDeployer.executeMigration(vaultProxy);

    assertEvent(executeMigrationReceipt, Dispatcher.abi.getEvent('MigrationExecuted'), {
      vaultProxy,
      nextVaultAccessor: nextComptrollerProxy,
      nextFundDeployer: nextFundDeployer,
      prevFundDeployer: fundDeployer,
      nextVaultLib: vaultLib,
      signalTimestamp: signalTime,
    });

    // confirm a whitelisted asset is allowed
    const incomingAssetAmount = utils.parseEther('50');
    // Send incomingAsset to vault
    await incomingAsset.transfer(vaultProxy.address, incomingAssetAmount);

    // track it and expect to pass
    const whitelistedTrackedAssetArgs = addTrackedAssetsArgs([incomingAsset]);
    const whitelistedTrackedAssetCallArgs = callOnIntegrationArgs({
      adapter: trackedAssetsAdapter,
      selector: addTrackedAssetsSelector,
      encodedCallArgs: whitelistedTrackedAssetArgs,
    });

    await nextComptrollerProxy
      .connect(fundOwner)
      .callOnExtension(
        integrationManager,
        IntegrationManagerActionId.CallOnIntegration,
        whitelistedTrackedAssetCallArgs,
      );

    // confirm a non-whitelisted asset is not allowed
    const nonWhitelistedAssetAmount = utils.parseEther('50');

    // send non-whitelisted asset to vault
    await nonWhitelistedAsset.transfer(vaultProxy.address, nonWhitelistedAssetAmount);

    // track it and expect to fail
    const trackedAssetArgs = addTrackedAssetsArgs([nonWhitelistedAsset]);
    const trackedAssetCallArgs = callOnIntegrationArgs({
      adapter: trackedAssetsAdapter,
      selector: addTrackedAssetsSelector,
      encodedCallArgs: trackedAssetArgs,
    });

    const addTrackedAssetsTx = nextComptrollerProxy
      .connect(fundOwner)
      .callOnExtension(integrationManager, IntegrationManagerActionId.CallOnIntegration, trackedAssetCallArgs);

    await expect(addTrackedAssetsTx).rejects.toBeRevertedWith(
      'VM Exception while processing transaction: revert Rule evaluated to false: ASSET_WHITELIST',
    );
  });
});
