import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';

export interface TransitionDefinition {
  from: string;
  to: string;
  allowedRoles?: string[];
  onTransition?: string;
}

@Injectable()
export class StateMachineService {
  private transitions: Map<string, TransitionDefinition[]> = new Map();

  registerDomain(domain: string, definitions: TransitionDefinition[]) {
    this.transitions.set(domain, definitions);
  }

  async transition(
    domain: string,
    currentStatus: string,
    targetStatus: string,
    options?: { userRole?: string; onSuccess?: () => Promise<void> },
  ): Promise<boolean> {
    const domainTransitions = this.transitions.get(domain);
    if (!domainTransitions) {
      throw new BadRequestException(`No state machine defined for domain: ${domain}`);
    }

    const validTransition = domainTransitions.find(
      (t) => t.from === currentStatus && t.to === targetStatus,
    );

    if (!validTransition) {
      const validTargets = domainTransitions
        .filter((t) => t.from === currentStatus)
        .map((t) => t.to);
      throw new BadRequestException(
        `Invalid transition: ${currentStatus} -> ${targetStatus}. ` +
        `Valid targets from "${currentStatus}": ${validTargets.join(', ') || 'none'}`,
      );
    }

    if (validTransition.allowedRoles?.length && options?.userRole) {
      if (!validTransition.allowedRoles.includes(options.userRole)) {
        throw new ForbiddenException(
          `Role "${options.userRole}" not allowed for ${currentStatus} -> ${targetStatus}. ` +
          `Required: ${validTransition.allowedRoles.join(', ')}`,
        );
      }
    }

    if (options?.onSuccess) {
      await options.onSuccess();
    }

    return true;
  }

  getValidTransitions(domain: string, currentStatus: string): string[] {
    const domainTransitions = this.transitions.get(domain);
    if (!domainTransitions) return [];
    return domainTransitions
      .filter((t) => t.from === currentStatus)
      .map((t) => t.to);
  }

  getAllTransitions(domain: string): TransitionDefinition[] {
    return this.transitions.get(domain) || [];
  }
}
