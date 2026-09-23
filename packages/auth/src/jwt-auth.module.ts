import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';
import { RolesGuard } from './roles.guard';
import { JWT_SECRET_FALLBACK_DEV, secretoRequerido } from './secretos.util';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: secretoRequerido('JWT_SECRET', JWT_SECRET_FALLBACK_DEV),
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? '15m' },
    }),
  ],
  // RolesGuard se provee y exporta aca para que los controllers que ya
  // importan este modulo puedan usarlo en @UseGuards sin declararlo de nuevo
  // en cada modulo.
  providers: [JwtStrategy, RolesGuard],
  exports: [JwtModule, PassportModule, RolesGuard],
})
export class JwtAuthModule {}
