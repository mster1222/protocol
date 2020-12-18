import { BytesLike, Signer } from 'ethers';
import { AddressLike } from '@crestproject/crestproject';
import {
  ChainlinkPriceFeed,
  ComptrollerLib,
  Dispatcher,
  FeeManager,
  FundDeployer,
  FundLifecycleLib,
  IntegrationManager,
  PermissionedVaultActionLib,
  PolicyManager,
  SynthetixPriceFeed,
  ValueInterpreter,
  VaultLib,
} from '@melonproject/protocol';

export async function createFundDeployer({
  deployer,
  chainlinkPriceFeed,
  dispatcher,
  feeManager,
  integrationManager,
  permissionedVaultActionLib,
  policyManager,
  synthetixAddressResolverAddress,
  synthetixPriceFeed,
  valueInterpreter,
  vaultLib,
  vaultCallContracts = [],
  vaultCallSelectors = [],
  setOnDispatcher = true,
}: {
  deployer: Signer;
  chainlinkPriceFeed: ChainlinkPriceFeed;
  dispatcher: Dispatcher;
  feeManager: FeeManager;
  integrationManager: IntegrationManager;
  permissionedVaultActionLib: PermissionedVaultActionLib;
  policyManager: PolicyManager;
  synthetixAddressResolverAddress: AddressLike;
  synthetixPriceFeed: SynthetixPriceFeed;
  valueInterpreter: ValueInterpreter;
  vaultLib: VaultLib;
  vaultCallContracts?: AddressLike[];
  vaultCallSelectors?: BytesLike[];
  setOnDispatcher?: boolean;
}) {
  const nextFundDeployer = await FundDeployer.deploy(
    deployer,
    dispatcher,
    vaultLib,
    vaultCallContracts,
    vaultCallSelectors,
  );
  const nextFundLifecycleLib = await FundLifecycleLib.deploy(
    deployer,
    nextFundDeployer,
    chainlinkPriceFeed,
    feeManager,
    integrationManager,
    policyManager,
  );
  const nextComptrollerLib = await ComptrollerLib.deploy(
    deployer,
    dispatcher,
    nextFundDeployer,
    valueInterpreter,
    feeManager,
    integrationManager,
    policyManager,
    nextFundLifecycleLib,
    permissionedVaultActionLib,
    synthetixPriceFeed,
    synthetixAddressResolverAddress,
  );
  await nextFundDeployer.setComptrollerLib(nextComptrollerLib);

  if (setOnDispatcher) {
    await dispatcher.setCurrentFundDeployer(nextFundDeployer);
  }

  return nextFundDeployer;
}
