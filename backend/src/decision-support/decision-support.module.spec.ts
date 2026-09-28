import { Test } from '@nestjs/testing';
import { DecisionSupportModule } from './decision-support.module';
import { DecisionSupportService } from './decision-support.service';
import { QueueAutomationService } from './queue-automation.service';
import { NotificationModule } from '../notification/notification.module';
import { PrismaService } from '../prisma.service';

/**
 * Guards the dependency graph, not the behaviour.
 *
 * This exists because the first build of this module failed in production with
 * `Nest can't resolve dependencies of the QueueAutomationService`. Neither
 * existing check caught it:
 *
 *   - `tsc` passes, because TypeScript does not model Nest's injector.
 *   - The service unit tests pass, because they register their own providers
 *     and so never exercise the real module.
 *
 * Compiling and initialising the actual module forces Nest to build the
 * injector, which is the only thing that can see a missing `imports` entry.
 * Cheap, and it is the difference between a failed deploy and a red test.
 */
describe('DecisionSupportModule', () => {
  it('resolves every provider in the real module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DecisionSupportModule],
    })
      // PrismaModule is @Global in the running app; stubbing the service keeps
      // this offline while still forcing the injector to wire every token.
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    // `init` is what instantiates providers. compile() alone builds the graph
    // without resolving constructor arguments, which is where the deploy failed.
    await moduleRef.init();

    expect(moduleRef.get(DecisionSupportService)).toBeInstanceOf(DecisionSupportService);
    // The provider whose missing import took the deploy down.
    expect(moduleRef.get(QueueAutomationService)).toBeInstanceOf(QueueAutomationService);

    await moduleRef.close();
  });

  it('imports NotificationModule, which QueueAutomationService injects', () => {
    const imports = Reflect.getMetadata('imports', DecisionSupportModule) as unknown[];
    expect(imports).toContain(NotificationModule);
  });
});
