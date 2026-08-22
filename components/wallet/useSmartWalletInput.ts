"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/components/wallet/WalletContext";
import { matchesConnectedWallet } from "@/lib/smartWalletInput";

export function useSmartWalletInput() {
  const { address } = useWallet();
  const [value, setValue] = useState("");
  const [followingConnectedWallet, setFollowingConnectedWallet] = useState(true);

  useEffect(() => {
    if (address && followingConnectedWallet) {
      // Wagmi is an external store; keep the editable field synchronized only
      // while the user has not opted out with a manual address.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setValue(address);
    }
  }, [address, followingConnectedWallet]);

  const updateValue = useCallback(
    (nextValue: string) => {
      setValue(nextValue);
      setFollowingConnectedWallet(matchesConnectedWallet(nextValue, address));
    },
    [address]
  );

  const useConnectedWallet = useCallback(() => {
    if (!address) return;
    setValue(address);
    setFollowingConnectedWallet(true);
  }, [address]);

  const differsFromConnectedWallet = Boolean(
    address && !matchesConnectedWallet(value, address)
  );

  return {
    connectedAddress: address,
    differsFromConnectedWallet,
    followingConnectedWallet,
    setValue: updateValue,
    useConnectedWallet,
    value,
  };
}
