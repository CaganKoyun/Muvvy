import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Consumer } from './consumer.entity';
import { IdentityService } from './identity.service';
import { AuthController } from './auth.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Consumer])],
  controllers: [AuthController],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
