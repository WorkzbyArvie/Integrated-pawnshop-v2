import { IsString, MaxLength } from 'class-validator';

/**
 * Photo-URL append for a ticket description.
 *
 * The vault embeds `[PHOTO_URL]` markers in the free-text description, so the
 * value stays a string rather than becoming a structured relation.
 */
export class UpdateTicketDescriptionDto {
  @IsString()
  @MaxLength(4000)
  description: string;
}
