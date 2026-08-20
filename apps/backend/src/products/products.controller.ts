import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, Request } from '@nestjs/common';
import { ProductsService } from './products.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ProductAvailability } from '@vereinorder/database';

@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @Roles('ADMINISTRATOR', 'WAITER', 'CASHIER', 'EVENT_MANAGER')
  async findAll() {
    return this.productsService.findAllActive();
  }

  @Get('admin')
  @Roles('ADMINISTRATOR', 'EVENT_MANAGER')
  async findAllProductsAdmin(@Query('eventId') eventId: string) {
    return this.productsService.findAllProductsAdmin(eventId);
  }

  @Get('station/:stationId')
  @Roles('ADMINISTRATOR', 'STATION', 'EVENT_MANAGER')
  async findByStation(@Param('stationId') stationId: string) {
    return this.productsService.findByStation(stationId);
  }

  @Patch(':id/availability')
  @Roles('ADMINISTRATOR', 'STATION', 'EVENT_MANAGER')
  async updateAvailability(
    @Request() req: any,
    @Param('id') id: string,
    @Body('availability') availability: ProductAvailability
  ) {
    const userId = req.user?.userId;
    return this.productsService.updateAvailability(id, availability, userId);
  }

  @Post()
  @Roles('ADMINISTRATOR', 'EVENT_MANAGER')
  async createProduct(@Request() req: any, @Body() data: any) {
    const userId = req.user?.userId;
    return this.productsService.createProduct(data, userId);
  }

  @Patch(':id')
  @Roles('ADMINISTRATOR', 'EVENT_MANAGER')
  async updateProduct(@Request() req: any, @Param('id') id: string, @Body() data: any) {
    const userId = req.user?.userId;
    return this.productsService.updateProduct(id, data, userId);
  }
}

@Controller('categories')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CategoriesController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @Roles('ADMINISTRATOR', 'EVENT_MANAGER')
  async findAllCategoriesAdmin(@Query('eventId') eventId: string) {
    return this.productsService.findAllCategoriesAdmin(eventId);
  }

  @Post()
  @Roles('ADMINISTRATOR', 'EVENT_MANAGER')
  async createCategory(@Body() data: any) {
    return this.productsService.createCategory(data);
  }

  @Patch(':id')
  @Roles('ADMINISTRATOR', 'EVENT_MANAGER')
  async updateCategory(@Param('id') id: string, @Body() data: any) {
    return this.productsService.updateCategory(id, data);
  }
}
