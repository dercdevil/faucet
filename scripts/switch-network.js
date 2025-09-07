#!/usr/bin/env node

/**
 * Script para cambiar fácilmente entre testnet y mainnet
 * Uso: node scripts/switch-network.js [testnet|mainnet]
 */

const fs = require("fs");
const path = require("path");

const ENV_FILE = path.join(process.cwd(), ".env");
const ENV_EXAMPLE = path.join(process.cwd(), "config.example.env");

function updateEnvFile(network) {
  let envContent = "";

  // Leer archivo .env existente o crear uno nuevo
  if (fs.existsSync(ENV_FILE)) {
    envContent = fs.readFileSync(ENV_FILE, "utf8");
  } else if (fs.existsSync(ENV_EXAMPLE)) {
    // Si no existe .env, copiar desde el ejemplo
    envContent = fs.readFileSync(ENV_EXAMPLE, "utf8");
    console.log("📄 Creando archivo .env desde config.example.env");
  } else {
    console.error("❌ No se encontró archivo .env ni config.example.env");
    process.exit(1);
  }

  // Actualizar o agregar NEXT_PUBLIC_NETWORK_MODE
  const networkModeRegex = /^NEXT_PUBLIC_NETWORK_MODE=.*$/m;
  const newNetworkMode = `NEXT_PUBLIC_NETWORK_MODE=${network}`;

  if (networkModeRegex.test(envContent)) {
    envContent = envContent.replace(networkModeRegex, newNetworkMode);
  } else {
    envContent += `\n${newNetworkMode}\n`;
  }

  // Escribir archivo actualizado
  fs.writeFileSync(ENV_FILE, envContent);
}

function showNetworkInfo(network) {
  const networks = {
    testnet: {
      name: "BSC Testnet",
      chainId: "97 (0x61)",
      currency: "tBNB",
      amount: "0.1 tBNB",
      explorer: "https://testnet.bscscan.com",
      faucet: "https://testnet.binance.org/faucet-smart",
      rpc: "https://data-seed-prebsc-1-s1.binance.org:8545/",
    },
    mainnet: {
      name: "BNB Smart Chain",
      chainId: "56 (0x38)",
      currency: "BNB",
      amount: "0.003 BNB (~$1 USD)",
      explorer: "https://bscscan.com",
      faucet: "N/A (Mainnet)",
      rpc: "https://bsc-dataseed.binance.org/",
    },
  };

  const info = networks[network];

  console.log("\n🌐 CONFIGURACIÓN DE RED ACTUALIZADA");
  console.log("=====================================");
  console.log(`📍 Red: ${info.name}`);
  console.log(`🔗 Chain ID: ${info.chainId}`);
  console.log(`💰 Moneda: ${info.currency}`);
  console.log(`💎 Cantidad por reclamo: ${info.amount}`);
  console.log(`🔍 Explorer: ${info.explorer}`);
  console.log(`🚰 Faucet oficial: ${info.faucet}`);
  console.log(`🌐 RPC: ${info.rpc}`);

  if (network === "testnet") {
    console.log("\n⚠️  MODO TESTNET ACTIVADO");
    console.log("- Los tokens NO tienen valor real");
    console.log("- Perfecto para desarrollo y pruebas");
    console.log("- Obtén tBNB gratis en el faucet oficial");
  } else {
    console.log("\n🚨 MODO MAINNET ACTIVADO");
    console.log("- Los tokens TIENEN valor real");
    console.log("- Asegúrate de tener BNB suficiente");
    console.log("- Verifica todas las configuraciones");
  }

  console.log("\n📋 PRÓXIMOS PASOS:");
  console.log("1. Reinicia la aplicación: npm run dev");
  console.log("2. Verifica que tu wallet tenga fondos");
  console.log("3. Confirma la red en MetaMask");
  console.log("=====================================\n");
}

function main() {
  const args = process.argv.slice(2);
  const network = args[0];

  if (!network || !["testnet", "mainnet"].includes(network)) {
    console.log("🚰 Script de Cambio de Red - BNB Faucet");
    console.log("========================================");
    console.log("");
    console.log("Uso: node scripts/switch-network.js [testnet|mainnet]");
    console.log("");
    console.log("Ejemplos:");
    console.log(
      "  node scripts/switch-network.js testnet   # Cambiar a testnet"
    );
    console.log(
      "  node scripts/switch-network.js mainnet   # Cambiar a mainnet"
    );
    console.log("");
    console.log("Redes disponibles:");
    console.log("  testnet - BSC Testnet (para desarrollo)");
    console.log("  mainnet - BNB Smart Chain (para producción)");
    process.exit(1);
  }

  try {
    updateEnvFile(network);
    showNetworkInfo(network);
    console.log(`✅ Red cambiada exitosamente a: ${network.toUpperCase()}`);
  } catch (error) {
    console.error("❌ Error al cambiar la red:", error.message);
    process.exit(1);
  }
}

main();
