// SPDX-License-Identifier: GPL-3.0

/*
    This file is part of the Enzyme Protocol.

    (c) Enzyme Council <council@enzyme.finance>

    For the full license information, please view the LICENSE
    file that was distributed with this source code.
*/

pragma solidity 0.6.12;

/// @title ITestMapleV2PoolManager Interface
/// @author Enzyme Council <security@enzyme.finance>
interface ITestMapleV2PoolManager {
    function withdrawalManager() external view returns (address withdrawalManager_);
}
