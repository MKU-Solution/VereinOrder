import { Module, Global } from '@nestjs/common';
import { PrismaClient } from '@vereinorder/database';

export const PRISMA_CLIENT = 'PRISMA_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: PRISMA_CLIENT,
      useFactory: () => {
        return new PrismaClient();
      },
    },
  ],
  exports: [PRISMA_CLIENT],
})
export class PrismaModule {}
