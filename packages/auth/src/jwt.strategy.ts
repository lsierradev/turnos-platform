import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from './jwt-payload.interface';
import { JWT_SECRET_FALLBACK_DEV, secretoRequerido } from './secretos.util';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secretoRequerido('JWT_SECRET', JWT_SECRET_FALLBACK_DEV),
    });
  }

  validate(payload: JwtPayload): JwtPayload {
    return payload;
  }
}
