export async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}

export function parseMessage(record) {
  const body = JSON.parse(record.body);
  const message = JSON.parse(body.message);
  return message;
}
