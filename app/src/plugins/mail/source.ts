/** where the mail is read from: Microsoft Graph when the Microsoft account is used for Emails, else the classic Outlook (COM) */
import { get } from '../../store';
import { mailFetch } from '../../platform';
import { methodOf } from '../config';
import { graphMail } from './graph';
import type { Input } from './graph';

export const viaGraph = () => methodOf(get().settings, 'mail') === 'app';
export const mailRead = (input: Input): Promise<string> => (viaGraph() ? graphMail(input) : mailFetch('mail', input));
