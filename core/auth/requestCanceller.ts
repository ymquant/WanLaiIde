export class RequestCanceller {
  private controllers = new Set<AbortController>();

  track(controller: AbortController): void {
    this.controllers.add(controller);
    controller.signal.addEventListener("abort", () => {
      this.controllers.delete(controller);
    });
  }

  abortAll(): void {
    for (const controller of this.controllers) {
      controller.abort();
    }
    this.controllers.clear();
  }
}
