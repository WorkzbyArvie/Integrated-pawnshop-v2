import { defineConfig } from '@prisma/config';
import * as dotenv from 'dotenv';

// Manually load the .env file
dotenv.config();

export default defineConfig({
  // Tell Prisma where your schema is
  schema: './prisma/schema.prisma',
  
  // ADD THIS BLOCK FOR SEEDING
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});