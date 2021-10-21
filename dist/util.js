export function toSecondsEpoch(date){if(!(date instanceof Date)){throw new Error(`${date} is not a Date!`)}return Math.floor(date.getTime()/1000)}export function debug(message,object){if(process.env.DYNAMODB_STORE_DEBUG){const argument=object||'';console.log(`${new Date().toString()} - DYNAMODB_STORE: ${message}`,typeof argument==='object'?JSON.stringify(argument):argument)}}export function isExpired(expiresOn){return!expiresOn||expiresOn<=toSecondsEpoch(new Date)}