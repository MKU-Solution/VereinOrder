import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ProductsService } from './products.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @Roles('ADMINISTRATOR', 'WAITER', 'CASHIER')
  async findAll() {
    return this.productsService.findAllActive();
  }

  @Get('admin')
  @Roles('ADMINISTRATOR', 'EVENT_MANAGER')
  async findAllProductsAdmin(@Query('eventId') eventId: string) {
    return this.productsService.findAllProductsAdmin(eventId);
  }

  @Post()
  @Roles('ADMINISTRATOR', 'EVENT_MANAGER')
  async createProduct(@Body() data: any) {
    return this.productsService.createProduct(data);
  }

  @Patch(':id')
  @Roles('ADMINISTRATOR', 'EVENT_MANAGER')
  async updateProduct(@Param('id') id: string, @Body() data: any) {
    return this.productsService.updateProduct(id, data);
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
