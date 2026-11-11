/** The developer panel's Emails: a few sorted mails, so the drawer can be seen without Outlook or a model. */
import type { Impl } from '../types';
import { entriesOf, tabsOf } from './model';
import type { MailState } from './model';

const at = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
const demo = (): MailState => ({
  me: 'You',
  items: [
    { id: 'm1', from: 'PagerDuty', addr: 'alerts@pagerduty.com', subject: 'TRIGGERED: api p99 latency > 2s', received: at(4), unread: true, cls: 'urgent', why: 'Production alert on a service you own' },
    { id: 'm2', from: 'Dana Whitfield', subject: 'Can you approve the release branch before 3?', received: at(25), unread: true, cls: 'today', why: 'Direct request with a deadline today' },
    { id: 'm3', from: 'Sam Ortega', subject: 'Re: retry policy for queued jobs', received: at(80), unread: true, cls: 'today', why: 'Question to you in a work thread' },
    { id: 'm4', from: 'Engineering All', subject: 'Q4 platform roadmap', received: at(300), unread: true, cls: 'eventually', why: 'Team announcement, no action' },
    { id: 'm5', from: 'Confluence', addr: 'confluence@acme.atlassian.net', subject: 'Daily digest: 4 pages updated', received: at(600), unread: false, cls: 'eventually', why: 'Digest of pages you watch' },
    { id: 'm6', from: 'Cloud Vendor', addr: 'news@vendor.example', subject: 'Modernise your stack without the heavy lift', received: at(900), unread: true, cls: 'dismiss', why: 'Marketing newsletter' },
    { id: 'm7', from: 'Jamie Lee', subject: 'Automatic reply: Out of office', received: at(1300), unread: true, cls: 'dismiss', why: 'Automatic reply' },
  ],
});

export const mock: Impl = {
  get lists() {
    return tabsOf(demo());
  },
  async list(id) {
    return entriesOf(demo(), id);
  },
};
