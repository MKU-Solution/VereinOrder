import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  ParseUUIDPipe,
} from "@nestjs/common";
import { ProductsService } from "./products.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import {
  CreateCategoryDto,
  CreateProductDto,
  UpdateAvailabilityDto,
  UpdateCategoryDto,
  UpdateProductDto,
} from "./dto/product.dto";

@Controller("products")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @Roles("ADMINISTRATOR", "WAITER", "CASHIER", "EVENT_MANAGER")
  async findAll() {
    return this.productsService.findAllActive();
  }

  @Get("admin")
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  async findAllProductsAdmin(
    @Query("eventId", new ParseUUIDPipe({ version: "4" })) eventId: string,
  ) {
    return this.productsService.findAllProductsAdmin(eventId);
  }

  @Get("station/:stationId")
  @Roles("ADMINISTRATOR", "STATION", "EVENT_MANAGER")
  async findByStation(
    @Param("stationId", new ParseUUIDPipe({ version: "4" })) stationId: string,
  ) {
    return this.productsService.findByStation(stationId);
  }

  @Patch(":id/availability")
  @Roles("ADMINISTRATOR", "STATION", "EVENT_MANAGER")
  async updateAvailability(
    @Request() req: { user?: { userId?: string } },
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() data: UpdateAvailabilityDto,
  ) {
    const userId = req.user?.userId;
    return this.productsService.updateAvailability(
      id,
      data.availability,
      userId,
    );
  }

  @Post()
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  async createProduct(
    @Request() req: { user?: { userId?: string } },
    @Body() data: CreateProductDto,
  ) {
    const userId = req.user?.userId;
    return this.productsService.createProduct(data, userId);
  }

  @Patch(":id")
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  async updateProduct(
    @Request() req: { user?: { userId?: string } },
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() data: UpdateProductDto,
  ) {
    const userId = req.user?.userId;
    return this.productsService.updateProduct(id, data, userId);
  }
}

@Controller("categories")
@UseGuards(JwtAuthGuard, RolesGuard)
export class CategoriesController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  async findAllCategoriesAdmin(
    @Query("eventId", new ParseUUIDPipe({ version: "4" })) eventId: string,
  ) {
    return this.productsService.findAllCategoriesAdmin(eventId);
  }

  @Post()
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  async createCategory(@Body() data: CreateCategoryDto) {
    return this.productsService.createCategory(data);
  }

  @Patch(":id")
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  async updateCategory(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() data: UpdateCategoryDto,
  ) {
    return this.productsService.updateCategory(id, data);
  }
}
