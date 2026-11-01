export const vinPrompt = 'Read the VIN in this image. Return only the 17-character VIN, or UNREADABLE if any character is uncertain. Do not guess, decode the vehicle, or add explanation.';

export function parseVinReply(reply) {
  if (typeof reply !== 'string') return { status: 'invalid' };
  const value = reply.trim().toUpperCase();
  if (value === 'UNREADABLE') return { status: 'unreadable' };
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(value) && /\d/.test(value)) return { status: 'candidate', vin: value };
  return { status: 'invalid' };
}
