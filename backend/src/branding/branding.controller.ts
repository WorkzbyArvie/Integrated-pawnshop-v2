import { Controller, Get, Post, Body, Param, Patch, Delete } from '@nestjs/common';
import { BrandingService } from './branding.service';
import { Prisma } from '@prisma/client';

@Controller('branding')
export class BrandingController {
  constructor(private readonly brandingService: BrandingService) {}

  @Post()
  create(@Body() data: Prisma.BrandingCreateInput) {
    return this.brandingService.create(data);
  }

  @Get()
  findAll() {
    return this.brandingService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.brandingService.findOne(Number(id));
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() data: Prisma.BrandingUpdateInput) {
    return this.brandingService.update(Number(id), data);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.brandingService.remove(Number(id));
  }
}
