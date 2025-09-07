// Configuración de redes BSC
export interface NetworkConfig {
  chainId: string;
  chainIdDecimal: number;
  chainName: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: string[];
  blockExplorerUrls: string[];
  faucetAmount: string;
  explorerName: string;
}

export const NETWORKS: Record<string, NetworkConfig> = {
  testnet: {
    chainId: "0x61", // 97 in hex
    chainIdDecimal: 97,
    chainName: "BSC Testnet",
    nativeCurrency: {
      name: "tBNB",
      symbol: "tBNB",
      decimals: 18,
    },
    rpcUrls: [
      "https://data-seed-prebsc-1-s1.binance.org:8545/",
      "https://data-seed-prebsc-2-s1.binance.org:8545/",
      "https://data-seed-prebsc-1-s2.binance.org:8545/",
    ],
    blockExplorerUrls: ["https://testnet.bscscan.com/"],
    faucetAmount: "0.003", // Más cantidad en testnet para pruebas
    explorerName: "BSCScan Testnet",
  },
  mainnet: {
    chainId: "0x38", // 56 in hex
    chainIdDecimal: 56,
    chainName: "BNB Smart Chain",
    nativeCurrency: {
      name: "BNB",
      symbol: "BNB",
      decimals: 18,
    },
    rpcUrls: [
      "https://bsc-dataseed.binance.org/",
      "https://bsc-dataseed1.defibit.io/",
      "https://bsc-dataseed1.ninicoin.io/",
    ],
    blockExplorerUrls: ["https://bscscan.com/"],
    faucetAmount: "0.003", // Cantidad menor en mainnet
    explorerName: "BSCScan",
  },
};

// Función para obtener la configuración actual basada en variables de entorno
export function getCurrentNetwork(): NetworkConfig {
  const networkMode = process.env.NEXT_PUBLIC_NETWORK_MODE || "testnet";
  return NETWORKS[networkMode] || NETWORKS.testnet;
}

// Función para obtener la configuración del cliente (frontend)
export function getClientNetwork(): NetworkConfig {
  if (typeof window !== "undefined") {
    const networkMode = process.env.NEXT_PUBLIC_NETWORK_MODE || "testnet";
    return NETWORKS[networkMode] || NETWORKS.testnet;
  }
  return NETWORKS.testnet;
}

// Función para verificar si estamos en testnet
export function isTestnet(): boolean {
  const networkMode = process.env.NEXT_PUBLIC_NETWORK_MODE || "testnet";
  return networkMode === "testnet";
}

// Función para obtener el RPC URL para el servidor
export function getServerRpcUrl(): string {
  const network = getCurrentNetwork();
  return process.env.BSC_RPC_URL || network.rpcUrls[0];
}
