import { hash, verify } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';

// OWASP 2024 minimum for argon2id: m=19 MiB, t=2, p=1. The library's default
// algorithm is argon2id (asserted in tests).
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

@Injectable()
export class PasswordService {
  // Verified against when the account does not exist, so an unknown email
  // costs the same time as a wrong password.
  private readonly dummy = hash('simorgh-timing-equaliser', OPTIONS);

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  async verify(stored: string | null | undefined, password: string): Promise<boolean> {
    if (!stored) {
      await verify(await this.dummy, password).catch(() => false);
      return false;
    }
    return verify(stored, password).catch(() => false);
  }
}
