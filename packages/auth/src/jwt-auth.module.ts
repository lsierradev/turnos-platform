import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';
import { JWT_SECRET_FALLBACK_DEV, secretoRequerido } from './secretos.util';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: secretoRequerido('JWT_SECRET', JWT_SECRET_FALLBACK_DEV),
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? '15m' },
    }),
  ],
  providers: [JwtStrategy],
  exports: [JwtModule, PassportModule],
})
export class JwtAuthModule {}
