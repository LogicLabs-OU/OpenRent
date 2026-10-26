/** Confirmation for irreversible actions (PRD §4.2.12) through one shared shadcn AlertDialog. */
export interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
}

class ConfirmState {
  open = $state(false);
  request = $state<ConfirmRequest | null>(null);
  private resolve: ((ok: boolean) => void) | null = null;

  ask(req: ConfirmRequest): Promise<boolean> {
    this.resolve?.(false);
    this.request = req;
    this.open = true;
    return new Promise((r) => (this.resolve = r));
  }

  settle(ok: boolean) {
    this.open = false;
    this.resolve?.(ok);
    this.resolve = null;
  }
}

export const confirmState = new ConfirmState();
export const confirmAction = (req: ConfirmRequest) => confirmState.ask(req);
