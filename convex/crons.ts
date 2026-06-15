import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

crons.daily('archive-activity-log', { hourUTC: 3, minuteUTC: 0 }, internal.activity.cleanup, {});

export default crons;
