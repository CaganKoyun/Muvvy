import { Global, Module } from '@nestjs/common';
import { EventBus } from './event-bus';

/** Global so any bounded context can publish/subscribe without re-importing. */
@Global()
@Module({
  providers: [EventBus],
  exports: [EventBus],
})
export class EventsModule {}
