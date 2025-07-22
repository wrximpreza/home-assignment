import { DynamoService } from './dynamoService';
import { SQSService } from './sqsService';
import { CloudWatchService } from './cloudWatchService';

export const dynamoService = new DynamoService();
export const sqsService = new SQSService();
export const cloudWatchService = new CloudWatchService();

export { DynamoService } from './dynamoService';
export { SQSService } from './sqsService';
export { CloudWatchService } from './cloudWatchService';
