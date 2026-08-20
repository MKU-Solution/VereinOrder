CREATE TABLE "AuthThrottle" (
  "key" TEXT NOT NULL,
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AuthThrottle_pkey" PRIMARY KEY ("key")
);
