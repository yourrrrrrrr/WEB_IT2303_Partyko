import { EventEmitter } from 'events';

export class EventBus extends EventEmitter {
  constructor() { super(); this.topics = new Map(); this.dlq = []; }
  publish(topic, event, headers = {}) {
    const record = { offset: (this.topics.get(topic)?.length || 0), topic, event, headers, ts: new Date().toISOString() };
    if (!this.topics.has(topic)) this.topics.set(topic, []);
    this.topics.get(topic).push(record);
    this.emit(topic, record);
    return record;
  }
  subscribe(topic, group, handler, fromOffset = 'latest') {
    const replay = this.topics.get(topic) || [];
    const start = fromOffset === 'earliest' ? 0 : replay.length;
    for (const record of replay.slice(start)) this.safeHandle(handler, record);
    this.on(topic, record => this.safeHandle(handler, record));
  }
  safeHandle(handler, record) {
    Promise.resolve(handler(record)).catch(error => this.dlq.push({ record, error: error.message }));
  }
}
export const bus = new EventBus();
