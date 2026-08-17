import type { LoggerPort } from "core/ports/loggerPort";
import * as vscode from "vscode";

export class OutputChannelLogger implements LoggerPort {
  private readonly channel: vscode.OutputChannel;

  constructor(channelName = "WanLai") {
    this.channel = vscode.window.createOutputChannel(channelName);
  }

  get outputChannel(): vscode.OutputChannel {
    return this.channel;
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.write("INFO", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.write("WARN", message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.write("ERROR", message, meta);
  }

  private write(
    level: string,
    message: string,
    meta?: Record<string, unknown>,
  ): void {
    const suffix =
      meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
    this.channel.appendLine(`[${level}] ${message}${suffix}`);
  }
}
