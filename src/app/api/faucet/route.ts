import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { FaucetDB } from "@/lib/database";
import {
  getCurrentNetwork,
  getServerRpcUrl,
  isTestnet,
} from "@/config/networks";

const network = getCurrentNetwork();
const BSC_RPC_URL = getServerRpcUrl();
const FAUCET_AMOUNT = ethers.parseEther(network.faucetAmount);

function getClientIP(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const realIP = request.headers.get("x-real-ip");

  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }

  if (realIP) {
    return realIP.trim();
  }

  // Fallback para desarrollo local
  return "127.0.0.1";
}

export async function POST(request: NextRequest) {
  try {
    // Obtener datos del request
    const body = await request.json();
    const { walletAddress } = body;

    // Validar dirección de wallet
    if (!walletAddress || !ethers.isAddress(walletAddress)) {
      return NextResponse.json(
        { error: "Dirección de wallet inválida" },
        { status: 400 }
      );
    }

    // Obtener IP del cliente
    const clientIP = getClientIP(request);

    // Verificar rate limiting
    const rateLimitCheck = FaucetDB.checkRateLimit(clientIP);
    if (!rateLimitCheck.allowed) {
      const timeLeft = rateLimitCheck.blockedUntil
        ? Math.ceil(
            (rateLimitCheck.blockedUntil.getTime() - Date.now()) / (1000 * 60)
          )
        : 0;

      return NextResponse.json(
        {
          error: `Demasiados intentos. Intenta de nuevo en ${timeLeft} minutos.`,
          rateLimited: true,
          blockedUntil: rateLimitCheck.blockedUntil,
        },
        { status: 429 }
      );
    }

    // Registrar intento
    FaucetDB.recordAttempt(clientIP);

    // Verificar si la IP ya reclamó
    if (FaucetDB.hasClaimedByIP(clientIP)) {
      return NextResponse.json(
        { error: "Esta IP ya ha reclamado BNB anteriormente" },
        { status: 403 }
      );
    }

    // Verificar si la wallet ya reclamó
    if (FaucetDB.hasClaimedByWallet(walletAddress)) {
      return NextResponse.json(
        { error: "Esta wallet ya ha reclamado BNB anteriormente" },
        { status: 403 }
      );
    }

    // Configurar provider y wallet del faucet
    const provider = new ethers.JsonRpcProvider(BSC_RPC_URL);
    const faucetPrivateKey = process.env.FAUCET_PK;

    if (!faucetPrivateKey) {
      console.error("FAUCET_PK no configurado en variables de entorno");
      return NextResponse.json(
        { error: "Error de configuración del servidor" },
        { status: 500 }
      );
    }

    const faucetWallet = new ethers.Wallet(faucetPrivateKey, provider);

    // Verificar balance del faucet
    const balance = await faucetWallet.provider!.getBalance(
      faucetWallet.address
    );
    if (balance < FAUCET_AMOUNT) {
      return NextResponse.json(
        { error: "El faucet no tiene suficiente balance" },
        { status: 503 }
      );
    }

    // Realizar la transferencia
    const tx = await faucetWallet.sendTransaction({
      to: walletAddress,
      value: FAUCET_AMOUNT,
      gasLimit: 21000,
    });

    // Esperar confirmación
    const receipt = await tx.wait();

    if (!receipt) {
      throw new Error("Transacción no confirmada");
    }

    // Guardar el claim en la base de datos
    FaucetDB.addClaim(clientIP, walletAddress);

    // Retornar éxito con hash de transacción
    return NextResponse.json({
      success: true,
      txHash: receipt.hash,
      amount: ethers.formatEther(FAUCET_AMOUNT),
      bscScanUrl: `${network.blockExplorerUrls[0]}tx/${receipt.hash}`,
      network: network.chainName,
      isTestnet: isTestnet(),
    });
  } catch (error) {
    console.error("Error en faucet API:", error);

    // Manejar errores específicos
    if (error instanceof Error) {
      if (error.message.includes("insufficient funds")) {
        return NextResponse.json(
          { error: "El faucet no tiene suficientes fondos" },
          { status: 503 }
        );
      }

      if (error.message.includes("gas")) {
        return NextResponse.json(
          { error: "Error de gas en la transacción" },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// Endpoint GET opcional para ver estadísticas
export async function GET() {
  try {
    const claims = FaucetDB.getAllClaims();
    const totalClaims = claims.length;
    const totalBNBDistributed =
      totalClaims * parseFloat(ethers.formatEther(FAUCET_AMOUNT));

    return NextResponse.json({
      totalClaims,
      totalBNBDistributed: totalBNBDistributed.toFixed(6),
      recentClaims: claims.slice(0, 10).map((claim) => ({
        wallet: claim.wallet.slice(0, 6) + "..." + claim.wallet.slice(-4),
        date: claim.createdAt,
      })),
    });
  } catch (error) {
    console.error("Error obteniendo estadísticas:", error);
    return NextResponse.json(
      { error: "Error obteniendo estadísticas" },
      { status: 500 }
    );
  }
}
