import { Module } from "@nestjs/common";
import { ProductsService } from "./products.service";
import {
  ProductsController,
  CategoriesController,
} from "./products.controller";

@Module({
  providers: [ProductsService],
  controllers: [ProductsController, CategoriesController],
})
export class ProductsModule {}
