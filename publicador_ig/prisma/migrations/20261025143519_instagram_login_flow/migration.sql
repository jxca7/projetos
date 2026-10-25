-- CreateEnum
CREATE TYPE "LoginFlow" AS ENUM ('INSTAGRAM_LOGIN', 'FACEBOOK_LOGIN');

-- AlterTable
ALTER TABLE "MetaApp" ADD COLUMN     "facebookAppId" TEXT,
ADD COLUMN     "loginFlow" "LoginFlow" NOT NULL DEFAULT 'INSTAGRAM_LOGIN';

-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "tokenRefreshedAt" TIMESTAMP(3);
