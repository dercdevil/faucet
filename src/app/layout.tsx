import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "BNB Faucet | Obtén BNB gratis para BSC",
  description:
    "Faucet de BNB para Binance Smart Chain. Obtén BNB gratis para pagar gas fees en tus transacciones.",
  keywords: "BNB, faucet, Binance Smart Chain, BSC, crypto, gratis",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
