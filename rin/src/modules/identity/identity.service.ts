import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { Consumer } from './consumer.entity';

@Injectable()
export class IdentityService {
  constructor(
    @InjectRepository(Consumer)
    private readonly repo: Repository<Consumer>,
  ) {}

  async register(email: string, password: string, phone?: string): Promise<Consumer> {
    const normalized = email.trim().toLowerCase();
    const exists = await this.repo.findOne({ where: { email: normalized } });
    if (exists) {
      throw new ConflictException('An identity with this email already exists.');
    }
    const consumer = this.repo.create({
      email: normalized,
      phone: phone ?? null,
      passwordHash: await bcrypt.hash(password, 10),
    });
    return this.repo.save(consumer);
  }

  async validateCredentials(email: string, password: string): Promise<Consumer> {
    const consumer = await this.repo.findOne({
      where: { email: email.trim().toLowerCase() },
    });
    if (!consumer || !(await bcrypt.compare(password, consumer.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    if (consumer.status !== 'active') {
      throw new UnauthorizedException('This identity is not active.');
    }
    return consumer;
  }

  async findById(id: string): Promise<Consumer> {
    const consumer = await this.repo.findOne({ where: { id } });
    if (!consumer) throw new NotFoundException('Consumer not found.');
    return consumer;
  }

  async findByEmail(email: string): Promise<Consumer | null> {
    return this.repo.findOne({ where: { email: email.trim().toLowerCase() } });
  }

  /**
   * Create an identity for a customer arriving via a passwordless method
   * (social login / passkey). A random password hash is set so the row is
   * well-formed; the customer authenticates with their external method.
   */
  async findOrCreateByEmail(email: string): Promise<Consumer> {
    const normalized = email.trim().toLowerCase();
    const existing = await this.repo.findOne({ where: { email: normalized } });
    if (existing) return existing;
    return this.repo.save(
      this.repo.create({
        email: normalized,
        passwordHash: await bcrypt.hash(randomBytes(24).toString('hex'), 10),
      }),
    );
  }
}
