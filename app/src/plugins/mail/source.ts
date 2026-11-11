/** where the mail is read from: Microsoft Graph when the Microsoft account is used for Emails, else the classic Outlook (COM) */
import { get } from '../../store';
import { mailFetch } from '../../platform';
import { graphMail } from './graph';
import type { Input } from './graph';

export const viaGraph = () => get().settings.entraSources.includes('mail');
export const mailRead = (input: Input): Promise<string> => (viaGraph() ? graphMail(input) : mailFetch('mail', input));
