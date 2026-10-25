import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dependencias que falam com Redis/Postgres por socket nao devem ser
  // empacotadas pelo bundler: ficam como require de Node no servidor.
  // Sem isso, o BullMQ arrasta drivers opcionais (valkey-glide) que nao
  // estao instalados e sujam o build com "module not found".
  serverExternalPackages: ["bullmq", "ioredis", "@prisma/adapter-pg", "pg"],

  eslint: {
    dirs: ["src", "scripts", "tests"],
  },
};

export default nextConfig;
