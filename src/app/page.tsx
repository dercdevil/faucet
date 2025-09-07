"use client";

import { useState, useEffect } from "react";
import { getClientNetwork, isTestnet } from "@/config/networks";

interface FaucetResponse {
  success?: boolean;
  txHash?: string;
  amount?: string;
  bscScanUrl?: string;
  error?: string;
  network?: string;
  isTestnet?: boolean;
}

interface NetworkInfo {
  chainId: string;
  chainName: string;
  isCorrectNetwork: boolean;
}

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
  removeListener: (
    event: string,
    callback: (...args: unknown[]) => void
  ) => void;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

// Obtener configuración de red actual
const CURRENT_NETWORK = getClientNetwork();

export default function FaucetPage() {
  const [walletAddress, setWalletAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FaucetResponse | null>(null);
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [walletConnected, setWalletConnected] = useState(false);
  const [connectedWalletAddress, setConnectedWalletAddress] = useState("");
  const [hasClaimed, setHasClaimed] = useState(false);
  const [captcha, setCaptcha] = useState({ question: "", answer: 0 });
  const [captchaInput, setCaptchaInput] = useState("");
  const [stats, setStats] = useState<{
    totalClaims: number;
    totalBNBDistributed: string;
    recentClaims: Array<{ wallet: string; date: string }>;
  } | null>(null);

  // Check if user has already claimed (cookie check)
  useEffect(() => {
    const checkClaimedStatus = () => {
      const claimed = document.cookie
        .split("; ")
        .find((row) => row.startsWith("faucet_claimed="));

      if (claimed) {
        setHasClaimed(true);
      }
    };

    checkClaimedStatus();
  }, []);

  // Check network and wallet connection
  useEffect(() => {
    const checkNetwork = async () => {
      if (typeof window !== "undefined" && window.ethereum) {
        try {
          const chainId = (await window.ethereum.request({
            method: "eth_chainId",
          })) as string;

          const isCorrectNetwork = chainId === CURRENT_NETWORK.chainId;

          setNetworkInfo({
            chainId,
            chainName: isCorrectNetwork
              ? CURRENT_NETWORK.chainName
              : "Red incorrecta",
            isCorrectNetwork,
          });

          // Check if wallet is connected
          const accounts = (await window.ethereum.request({
            method: "eth_accounts",
          })) as string[];

          if (accounts.length > 0) {
            setWalletConnected(true);
            setConnectedWalletAddress(accounts[0]);
            // Auto-llenar el campo si está vacío
            setWalletAddress((prevAddress) => {
              if (!prevAddress) {
                return accounts[0];
              }
              return prevAddress;
            });
          }
        } catch (error) {
          console.error("Error checking network:", error);
        }
      }
    };

    checkNetwork();

    // Solo escuchar cambios de red, no de cuentas para evitar conflictos
    if (window.ethereum) {
      window.ethereum.on("chainChanged", checkNetwork);

      return () => {
        if (window.ethereum) {
          window.ethereum.removeListener("chainChanged", checkNetwork);
        }
      };
    }
  }, []); // Sin dependencias para evitar re-ejecución

  const connectWallet = async () => {
    if (!window.ethereum) {
      alert("Por favor instala MetaMask u otra wallet compatible");
      return;
    }

    try {
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];

      if (accounts.length > 0) {
        setWalletConnected(true);
        setConnectedWalletAddress(accounts[0]);
        setWalletAddress(accounts[0]);
      }
    } catch (error) {
      console.error("Error connecting wallet:", error);
    }
  };

  const disconnectWallet = () => {
    console.log("Desconectando wallet..."); // Debug

    // Limpiar todos los estados relacionados con la wallet
    setWalletConnected(false);
    setConnectedWalletAddress("");
    setWalletAddress("");
    setResult(null);
    setCaptchaInput("");
    generateCaptcha();

    console.log("Wallet desconectada"); // Debug
  };

  const switchToBSC = async () => {
    if (!window.ethereum) return;

    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CURRENT_NETWORK.chainId }],
      });
    } catch (switchError: unknown) {
      // This error code indicates that the chain has not been added to MetaMask
      if (
        switchError &&
        typeof switchError === "object" &&
        "code" in switchError &&
        switchError.code === 4902
      ) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [CURRENT_NETWORK],
          });
        } catch (addError) {
          console.error("Error adding BSC network:", addError);
        }
      } else {
        console.error("Error switching to BSC:", switchError);
      }
    }
  };

  const setCookie = (name: string, value: string, days: number) => {
    const expires = new Date();
    expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/`;
  };

  const generateCaptcha = () => {
    const num1 = Math.floor(Math.random() * 10) + 1;
    const num2 = Math.floor(Math.random() * 10) + 1;
    const operations = ["+", "-", "*"];
    const operation = operations[Math.floor(Math.random() * operations.length)];

    let answer: number;
    let question: string;

    switch (operation) {
      case "+":
        answer = num1 + num2;
        question = `${num1} + ${num2}`;
        break;
      case "-":
        // Ensure positive result
        const larger = Math.max(num1, num2);
        const smaller = Math.min(num1, num2);
        answer = larger - smaller;
        question = `${larger} - ${smaller}`;
        break;
      case "*":
        // Use smaller numbers for multiplication
        const smallNum1 = Math.floor(Math.random() * 5) + 1;
        const smallNum2 = Math.floor(Math.random() * 5) + 1;
        answer = smallNum1 * smallNum2;
        question = `${smallNum1} × ${smallNum2}`;
        break;
      default:
        answer = num1 + num2;
        question = `${num1} + ${num2}`;
    }

    setCaptcha({ question, answer });
    setCaptchaInput("");
  };

  // Generate captcha on component mount
  useEffect(() => {
    generateCaptcha();
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const response = await fetch("/api/faucet");
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error("Error loading stats:", error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!walletAddress.trim()) {
      setResult({ error: "Por favor ingresa una dirección de wallet" });
      return;
    }

    // Validate captcha
    if (parseInt(captchaInput) !== captcha.answer) {
      setResult({
        error:
          "Captcha incorrecto. Por favor resuelve la operación matemática.",
      });
      generateCaptcha(); // Generate new captcha
      return;
    }

    // Check if user already claimed via cookie
    if (hasClaimed) {
      setResult({
        error:
          "Ya has reclamado BNB anteriormente. Solo se permite un reclamo por usuario.",
      });
      return;
    }

    // Check if user is on correct network
    if (networkInfo && !networkInfo.isCorrectNetwork) {
      setResult({
        error:
          "Por favor cambia a la red BNB Smart Chain (BSC) para continuar.",
      });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const response = await fetch("/api/faucet", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ walletAddress: walletAddress.trim() }),
      });

      const data: FaucetResponse = await response.json();

      // If successful, set cookie to prevent future claims
      if (data.success) {
        setCookie("faucet_claimed", "true", 30); // 30 days
        setHasClaimed(true);
        loadStats(); // Reload stats after successful claim
      }

      setResult(data);
    } catch (error) {
      console.error("Error:", error);
      setResult({ error: "Error de conexión. Inténtalo de nuevo." });
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setWalletAddress("");
    setResult(null);
    generateCaptcha();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-900 via-teal-900 to-green-950 relative overflow-hidden">
      {/* Imagen de fondo */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-20"
        style={{
          backgroundImage: "url('/img/grabacion.webp')",
          backgroundPosition: "center top",
          backgroundSize: "cover",
        }}
      ></div>

      {/* Overlay gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-900/80 via-teal-900/80 to-green-950/80"></div>

      {/* Patrón hexagonal de fondo */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-10 left-10 w-20 h-20 border border-emerald-400 rotate-12 hexagon"></div>
        <div className="absolute top-32 right-20 w-16 h-16 border border-teal-400 rotate-45 hexagon"></div>
        <div className="absolute bottom-40 left-32 w-24 h-24 border border-green-400 rotate-12 hexagon"></div>
        <div className="absolute top-60 left-1/3 w-12 h-12 border border-emerald-300 rotate-45 hexagon"></div>
        <div className="absolute bottom-20 right-40 w-18 h-18 border border-teal-300 rotate-12 hexagon"></div>
        <div className="absolute top-20 right-1/3 w-14 h-14 border border-green-300 rotate-45 hexagon"></div>
      </div>

      {/* Header navegación */}
      <nav className="relative z-10 flex justify-between items-center px-8 py-6">
        <div className="flex items-center space-x-2">
          <div className="w-10 h-10 bg-emerald-500 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-lg">🚰</span>
          </div>
          <div className="flex flex-col">
            <span className="text-white font-bold text-xl">BNB Faucet</span>
            {isTestnet() && (
              <span className="text-yellow-400 text-xs font-medium bg-yellow-400/20 px-2 py-1 rounded">
                TESTNET
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-6 text-emerald-200">
          <span className="hover:text-white cursor-pointer transition-colors">
            Inicio
          </span>
          <span className="hover:text-white cursor-pointer transition-colors">
            Faucet
          </span>
          <div className="flex items-center space-x-2">
            <span className="text-sm">Hecho por</span>
            <a
              href="https://tokenizados.net/es"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 hover:text-emerald-300 transition-colors font-medium text-sm"
            >
              Tokenizados
            </a>
            <span className="w-2 h-2 bg-emerald-400 rounded-full"></span>
          </div>
        </div>
      </nav>
      {/* Contenido principal */}
      <div className="container mx-auto px-4 py-16 relative z-10">
        <div className="max-w-4xl mx-auto">
          {/* Hero Section */}
          <div className="text-center mb-16">
            <h1 className="text-6xl md:text-7xl font-bold text-white mb-6 leading-tight">
              Bienvenido al <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-400">
                BNB Faucet de Tokenizados
              </span>
            </h1>
            {/* <p className="text-xl text-emerald-200 mb-8 max-w-2xl mx-auto leading-relaxed">
              Tu portal para obtener {CURRENT_NETWORK.nativeCurrency.symbol}{" "}
              gratuito en {CURRENT_NETWORK.chainName}
              {isTestnet() && (
                <span className="block text-yellow-400 text-lg mt-2 font-semibold">
                  🧪 Modo de Pruebas - Testnet
                </span>
              )}
            </p> */}
            <div className="flex justify-center">
              <div className="animate-bounce">
                <svg
                  className="w-6 h-6 text-emerald-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M19 14l-7 7m0 0l-7-7m7 7V3"
                  ></path>
                </svg>
              </div>
            </div>
          </div>

          {/* Network Status and Wallet Connection */}
          <div className="max-w-2xl mx-auto mb-8">
            <div className="bg-black/20 backdrop-blur-sm border border-emerald-500/20 rounded-2xl p-6">
              <div className="flex flex-col space-y-4">
                {/* Network Status */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div
                      className={`w-3 h-3 rounded-full ${
                        networkInfo?.isCorrectNetwork
                          ? "bg-green-400"
                          : "bg-red-400"
                      }`}
                    ></div>
                    <span className="text-white font-medium">
                      Red: {networkInfo?.chainName || "No detectada"}
                    </span>
                  </div>
                  {networkInfo && !networkInfo.isCorrectNetwork && (
                    <button
                      onClick={switchToBSC}
                      className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      Cambiar a {CURRENT_NETWORK.chainName}
                    </button>
                  )}
                </div>

                {/* Wallet Connection */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div
                      className={`w-3 h-3 rounded-full ${
                        walletConnected ? "bg-green-400" : "bg-gray-400"
                      }`}
                    ></div>
                    <div className="flex flex-col">
                      <span className="text-white font-medium">
                        Wallet: {walletConnected ? "Conectada" : "No conectada"}
                      </span>
                      {walletConnected && connectedWalletAddress && (
                        <span className="text-emerald-300 text-xs font-mono">
                          {connectedWalletAddress.slice(0, 6)}...
                          {connectedWalletAddress.slice(-4)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    {!walletConnected ? (
                      <button
                        onClick={connectWallet}
                        className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors"
                      >
                        Conectar Wallet
                      </button>
                    ) : (
                      <button
                        onClick={disconnectWallet}
                        className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors"
                      >
                        Desconectar
                      </button>
                    )}
                  </div>
                </div>

                {/* Claim Status */}
                {hasClaimed && (
                  <div className="flex items-center space-x-3 p-3 bg-yellow-500/10 border border-yellow-400/30 rounded-lg">
                    <div className="w-3 h-3 bg-yellow-400 rounded-full"></div>
                    <span className="text-yellow-300 font-medium">
                      Ya has reclamado BNB. Próximo reclamo disponible en 30
                      días.
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Formulario Principal */}
          <div className="max-w-2xl mx-auto mb-16">
            <div className="bg-black/30 backdrop-blur-lg rounded-3xl border border-emerald-500/20 p-8 shadow-2xl">
              <div className="mb-6">
                <h2 className="text-2xl font-semibold text-white mb-2">
                  Reclamar {CURRENT_NETWORK.nativeCurrency.symbol}
                </h2>
                <p className="text-emerald-200">
                  Ingresa tu dirección de wallet para recibir{" "}
                  {CURRENT_NETWORK.nativeCurrency.symbol} gratuito
                  {isTestnet() && (
                    <span className="block text-yellow-300 text-sm mt-1">
                      ⚠️ Esto es testnet - Los tokens no tienen valor real
                    </span>
                  )}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label
                      htmlFor="wallet"
                      className="block text-sm font-semibold text-emerald-200"
                    >
                      Dirección de Wallet ({CURRENT_NETWORK.chainName})
                    </label>
                    {walletConnected && connectedWalletAddress && (
                      <button
                        type="button"
                        onClick={() => setWalletAddress(connectedWalletAddress)}
                        className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                      >
                        ✓ Usar wallet conectada
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      id="wallet"
                      type="text"
                      value={walletAddress}
                      onChange={(e) => setWalletAddress(e.target.value)}
                      placeholder="0x742d35Cc6634C0532925a3b8D404fC8c76B1a458"
                      className="w-full px-4 py-4 bg-black/40 border border-emerald-500/30 rounded-xl text-white placeholder-emerald-300/50 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 transition-all duration-200 text-sm font-mono backdrop-blur-sm"
                      disabled={loading}
                    />
                    <div className="absolute right-3 top-1/2 transform -translate-y-1/2 flex items-center space-x-2">
                      {walletConnected &&
                        walletAddress === connectedWalletAddress && (
                          <span
                            className="text-green-400 text-xs"
                            title="Usando wallet conectada"
                          >
                            <svg
                              className="w-4 h-4"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              ></path>
                            </svg>
                          </span>
                        )}
                      <span className="text-emerald-400">
                        <svg
                          className="w-5 h-5"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4zM18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z"></path>
                        </svg>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Captcha Field */}
                <div>
                  <label
                    htmlFor="captcha"
                    className="block text-sm font-semibold text-emerald-200 mb-3"
                  >
                    Verificación de seguridad
                  </label>
                  <div className="flex items-center space-x-4">
                    <div className="bg-black/40 border border-emerald-500/30 rounded-xl px-4 py-3 text-white font-mono text-lg min-w-[120px] text-center backdrop-blur-sm">
                      {captcha.question} = ?
                    </div>
                    <input
                      id="captcha"
                      type="number"
                      value={captchaInput}
                      onChange={(e) => setCaptchaInput(e.target.value)}
                      placeholder="Resultado"
                      className="flex-1 px-4 py-3 bg-black/40 border border-emerald-500/30 rounded-xl text-white placeholder-emerald-300/50 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 transition-all duration-200 text-center font-mono backdrop-blur-sm"
                      disabled={loading}
                      required
                    />
                    <button
                      type="button"
                      onClick={generateCaptcha}
                      className="px-3 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-colors"
                      disabled={loading}
                      title="Generar nuevo captcha"
                    >
                      🔄
                    </button>
                  </div>
                  <p className="text-emerald-300/60 text-xs mt-2">
                    Resuelve la operación matemática para continuar
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={
                    loading ||
                    hasClaimed ||
                    networkInfo?.isCorrectNetwork === false
                  }
                  className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-bold py-4 px-8 rounded-xl transition-all duration-300 transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none shadow-lg hover:shadow-emerald-500/25"
                >
                  {loading ? (
                    <div className="flex items-center justify-center space-x-2">
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Procesando transferencia...</span>
                    </div>
                  ) : hasClaimed ? (
                    <div className="flex items-center justify-center space-x-2">
                      <span>✓</span>
                      <span>Ya reclamado</span>
                    </div>
                  ) : networkInfo && !networkInfo.isCorrectNetwork ? (
                    <div className="flex items-center justify-center space-x-2">
                      <span>⚠️</span>
                      <span>Red incorrecta</span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center space-x-2">
                      <span>💎</span>
                      <span>
                        Reclamar {CURRENT_NETWORK.faucetAmount}{" "}
                        {CURRENT_NETWORK.nativeCurrency.symbol}
                      </span>
                    </div>
                  )}
                </button>
              </form>

              {/* Results */}
              {result && (
                <div className="mt-8">
                  {result.success ? (
                    <div className="bg-emerald-500/10 border border-emerald-400/30 rounded-xl p-6 backdrop-blur-sm">
                      <div className="flex items-center mb-4">
                        <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center mr-3">
                          <span className="text-white text-sm">✓</span>
                        </div>
                        <h3 className="text-lg font-semibold text-emerald-300">
                          ¡Transacción Exitosa!
                        </h3>
                      </div>

                      <div className="space-y-4 text-sm">
                        <div className="flex justify-between items-center">
                          <span className="text-emerald-200">
                            Cantidad enviada:
                          </span>
                          <span className="text-white font-semibold">
                            {result.amount} BNB
                          </span>
                        </div>

                        <div>
                          <span className="text-emerald-200 block mb-2">
                            Hash de transacción:
                          </span>
                          <div className="bg-black/40 p-3 rounded-lg font-mono text-xs text-white break-all border border-emerald-500/20">
                            {result.txHash}
                          </div>
                        </div>

                        {result.bscScanUrl && (
                          <div className="pt-4">
                            <a
                              href={result.bscScanUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-lg hover:from-emerald-600 hover:to-teal-600 transition-all duration-200 font-semibold"
                            >
                              <span>Ver en {CURRENT_NETWORK.explorerName}</span>
                              <svg
                                className="ml-2 w-4 h-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="2"
                                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                                ></path>
                              </svg>
                            </a>
                          </div>
                        )}
                      </div>

                      <button
                        onClick={resetForm}
                        className="mt-6 text-emerald-400 hover:text-emerald-300 text-sm font-medium transition-colors"
                      >
                        ← Realizar otro reclamo
                      </button>
                    </div>
                  ) : (
                    <div className="bg-red-500/10 border border-red-400/30 rounded-xl p-6 backdrop-blur-sm">
                      <div className="flex items-center mb-3">
                        <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center mr-3">
                          <span className="text-white text-sm">✕</span>
                        </div>
                        <h3 className="text-lg font-semibold text-red-300">
                          Error en la transacción
                        </h3>
                      </div>

                      <p className="text-red-200 mb-4">{result.error}</p>

                      <button
                        onClick={resetForm}
                        className="text-red-400 hover:text-red-300 text-sm font-medium transition-colors"
                      >
                        ← Intentar de nuevo
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Características */}
          {/* <div className="mt-16">
            <div className="text-center mb-8">
              <h3 className="text-2xl font-bold text-white mb-2">
                CARACTERÍSTICAS
              </h3>
              <div className="w-24 h-1 bg-gradient-to-r from-emerald-400 to-teal-400 mx-auto"></div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-black/20 backdrop-blur-sm border border-emerald-500/20 rounded-2xl p-6 hover:border-emerald-400/40 transition-all duration-300 group">
                <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <span className="text-white text-xl">⏱️</span>
                </div>
                <h4 className="font-semibold text-white mb-2">
                  Una vez por IP
                </h4>
                <p className="text-emerald-200 text-sm leading-relaxed">
                  Cada dirección IP puede reclamar solo una vez para prevenir
                  abuso del sistema
                </p>
              </div>

              <div className="bg-black/20 backdrop-blur-sm border border-emerald-500/20 rounded-2xl p-6 hover:border-emerald-400/40 transition-all duration-300 group">
                <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <span className="text-white text-xl">💰</span>
                </div>
                <h4 className="font-semibold text-white mb-2">
                  {isTestnet()
                    ? `${CURRENT_NETWORK.faucetAmount} ${CURRENT_NETWORK.nativeCurrency.symbol}`
                    : `~$1 USD en ${CURRENT_NETWORK.nativeCurrency.symbol}`}
                </h4>
                <p className="text-emerald-200 text-sm leading-relaxed">
                  {isTestnet()
                    ? "Tokens de prueba para desarrollo y testing"
                    : `Suficiente para múltiples transacciones en ${CURRENT_NETWORK.chainName}`}
                </p>
              </div>

              <div className="bg-black/20 backdrop-blur-sm border border-emerald-500/20 rounded-2xl p-6 hover:border-emerald-400/40 transition-all duration-300 group">
                <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <span className="text-white text-xl">🔒</span>
                </div>
                <h4 className="font-semibold text-white mb-2">
                  Totalmente Seguro
                </h4>
                <p className="text-emerald-200 text-sm leading-relaxed">
                  Solo necesitas tu dirección de wallet, sin claves privadas
                </p>
              </div>
            </div>
          </div> */}

          {/* Statistics Dashboard */}
          {stats && (
            <div className="mt-16">
              <div className="text-center mb-8">
                <h3 className="text-2xl font-bold text-white mb-2">
                  ESTADÍSTICAS DEL FAUCET
                </h3>
                <div className="w-24 h-1 bg-gradient-to-r from-emerald-400 to-teal-400 mx-auto"></div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-black/20 backdrop-blur-sm border border-emerald-500/20 rounded-2xl p-6 text-center">
                  <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-xl flex items-center justify-center mx-auto mb-4">
                    <span className="text-white text-xl">📊</span>
                  </div>
                  <div className="text-3xl font-bold text-white mb-2">
                    {stats.totalClaims}
                  </div>
                  <div className="text-emerald-200 text-sm">
                    Total de reclamos
                  </div>
                </div>

                <div className="bg-black/20 backdrop-blur-sm border border-emerald-500/20 rounded-2xl p-6 text-center">
                  <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-xl flex items-center justify-center mx-auto mb-4">
                    <span className="text-white text-xl">💰</span>
                  </div>
                  <div className="text-3xl font-bold text-white mb-2">
                    {stats.totalBNBDistributed}
                  </div>
                  <div className="text-emerald-200 text-sm">
                    BNB distribuido
                  </div>
                </div>

                <div className="bg-black/20 backdrop-blur-sm border border-emerald-500/20 rounded-2xl p-6 text-center">
                  <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-xl flex items-center justify-center mx-auto mb-4">
                    <span className="text-white text-xl">👥</span>
                  </div>
                  <div className="text-3xl font-bold text-white mb-2">
                    {stats.recentClaims?.length || 0}
                  </div>
                  <div className="text-emerald-200 text-sm">
                    Reclamos recientes
                  </div>
                </div>
              </div>

              {/* Recent Claims */}
              {stats.recentClaims && stats.recentClaims.length > 0 && (
                <div className="bg-black/20 backdrop-blur-sm border border-emerald-500/20 rounded-2xl p-6">
                  <h4 className="text-lg font-semibold text-white mb-4 flex items-center">
                    <span className="mr-2">🕒</span>
                    Reclamos Recientes
                  </h4>
                  <div className="space-y-3">
                    {stats.recentClaims
                      .slice(0, 5)
                      .map((claim, index: number) => (
                        <div
                          key={index}
                          className="flex justify-between items-center py-2 px-3 bg-black/30 rounded-lg"
                        >
                          <div className="flex items-center space-x-3">
                            <div className="w-2 h-2 bg-emerald-400 rounded-full"></div>
                            <span className="text-emerald-200 font-mono text-sm">
                              {claim.wallet}
                            </span>
                          </div>
                          <div className="text-emerald-300 text-xs">
                            {new Date(claim.date).toLocaleDateString("es-ES", {
                              day: "2-digit",
                              month: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="mt-16 text-center border-t border-emerald-500/20 pt-8">
            <p className="text-emerald-300/60 text-sm">
              Para uso en {CURRENT_NETWORK.chainName} • Faucet desarrollado para
              la comunidad crypto
              {isTestnet() && (
                <span className="block text-yellow-400 mt-1">
                  🧪 Entorno de pruebas - No usar en producción
                </span>
              )}
            </p>
            <div className="flex justify-center items-center mt-4 space-x-4">
              <span className="text-emerald-400 text-xs">Powered by</span>
              <div className="flex items-center space-x-2">
                <span className="text-white font-semibold">Next.js</span>
                <span className="text-emerald-400">•</span>
                <span className="text-white font-semibold">Ethers.js</span>
                <span className="text-emerald-400">•</span>
                <span className="text-white font-semibold">BSC</span>
                <span className="text-emerald-400">•</span>
                <a
                  href="https://tokenizados.net/es"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-400 hover:text-emerald-300 transition-colors font-semibold"
                >
                  Tokenizados
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
